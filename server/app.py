import os
import json
import uuid
import base64
import shortuuid
import requests
from datetime import datetime
from functools import wraps
from pathlib import Path
from flask import Flask, request, session, redirect, jsonify, url_for
from github import Github, GithubException
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
from flask_cors import CORS

# Load environment variables
env_path = Path(__file__).parent / '.env'
if env_path.exists():
    from dotenv import dotenv_values
    config = dotenv_values(env_path)
    # Force set the environment variables
    for key, value in config.items():
        os.environ[key] = value

# Print loaded values (without exposing secrets)
for var in ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'UPSTREAM_REPO', 'BASE_BRANCH']:
    value = os.getenv(var)
    if var.endswith('SECRET'):
        print(f"{var}: {'*' * 8 if value else 'Not set'}")
    else:
        print(f"{var}: {value if value else 'Not set'}")

# Validate required environment variables
required_env_vars = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'APP_SECRET_KEY', 'UPSTREAM_REPO']
missing_vars = [var for var in required_env_vars if not os.getenv(var)]

if missing_vars:
    print(f"Error: Missing required environment variables: {', '.join(missing_vars)}")
    print("Please check your .env file and ensure all required variables are set.")
    print("You can copy .env.example to .env and fill in the values.")
    exit(1)

app = Flask(__name__, static_folder='..', static_url_path='')
app.secret_key = os.getenv('APP_SECRET_KEY')
CORS(app, supports_credentials=True)

# GitHub configuration
GITHUB_CLIENT_ID = os.getenv('GITHUB_CLIENT_ID')
GITHUB_CLIENT_SECRET = os.getenv('GITHUB_CLIENT_SECRET')
UPSTREAM_REPO = os.getenv('UPSTREAM_REPO')
BASE_BRANCH = os.getenv('BASE_BRANCH', 'dev')
UPLOAD_FOLDER = Path('uploads')
UPLOAD_FOLDER.mkdir(exist_ok=True)

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'github_token' not in session:
            return jsonify({'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function

@app.route('/auth/github')
def github_auth():
    return redirect(f'https://github.com/login/oauth/authorize?client_id={GITHUB_CLIENT_ID}&scope=repo')

@app.route('/auth/github/callback')
def github_callback():
    if 'error' in request.args:
        return jsonify({'error': request.args['error']}), 400
    
    code = request.args.get('code')
    if not code:
        return jsonify({'error': 'No code provided'}), 400

    # Exchange code for token
    response = requests.post(
        'https://github.com/login/oauth/access_token',
        headers={'Accept': 'application/json'},
        data={
            'client_id': GITHUB_CLIENT_ID,
            'client_secret': GITHUB_CLIENT_SECRET,
            'code': code
        }
    )
    
    data = response.json()
    if 'access_token' not in data:
        return jsonify({'error': 'Failed to get access token'}), 400
    
    session['github_token'] = data['access_token']
    return redirect('/')

@app.route('/auth/check')
def check_auth():
    if 'github_token' not in session:
        return jsonify({'authenticated': False})
    
    # Get user info from GitHub
    try:
        g = Github(session['github_token'])
        user = g.get_user()
        return jsonify({
            'authenticated': True,
            'username': user.login,
            'avatar_url': user.avatar_url
        })
    except (Exception, GithubException) as e:
        print(f"Error getting user info: {e}")
        session.pop('github_token', None)  # Clear invalid token
        return jsonify({'authenticated': False})

@app.route('/auth/logout')
def logout():
    session.pop('github_token', None)
    return jsonify({'success': True})

@app.route('/submit', methods=['POST'])
@login_required
def submit_device():
    try:
        # Get form data
        slug = request.form.get('slug')
        board_name = request.form.get('boardName')
        description = request.form.get('description')
        chip_type = request.form.get('chipType')
        product_link = request.form.get('productLink')
        gpio_pins = json.loads(request.form.get('gpioPins', '{}'))
        tags = request.form.get('tags', '').split(',')
        yaml_config = request.form.get('yamlConfig')

        # Validate required fields
        if not all([slug, board_name, description, chip_type, gpio_pins, tags, yaml_config]):
            return jsonify({'error': 'Missing required fields'}), 400

        # Initialize GitHub client
        g = Github(session['github_token'])
        upstream = g.get_repo(UPSTREAM_REPO)
        user = g.get_user()

        # Fork repository if not already forked
        try:
            fork = user.get_repo(UPSTREAM_REPO.split('/')[1])
        except GithubException:
            fork = user.create_fork(upstream)

        # Generate unique branch name
        timestamp = datetime.now().strftime('%Y%m%d')
        branch_name = f"device/{slug}-{shortuuid.uuid()[:8]}-{timestamp}"

        # Get base branch reference
        base_branch = upstream.get_branch(BASE_BRANCH)
        base_sha = base_branch.commit.sha

        # Create new branch
        ref = f"refs/heads/{branch_name}"
        fork.create_git_ref(ref=ref, sha=base_sha)

        # Process and save images
        image_paths = []
        for key in request.files:
            if key.startswith('image'):
                file = request.files[key]
                if file and file.filename:
                    filename = secure_filename(file.filename)
                    image_path = f"{slug}/images/{filename}"
                    image_paths.append(image_path)
                    
                    # Convert image to base64
                    image_data = base64.b64encode(file.read()).decode('utf-8')
                    fork.create_file(
                        path=image_path,
                        message=f"Add image {filename} for {slug}",
                        content=image_data,
                        branch=branch_name
                    )

        # Create device.yaml
        device_yaml = f"""
chip: {chip_type.lower()}
board: {slug}
name: {board_name}

# Board Description
description: {description}

# Tags
tags: {', '.join(tags)}

# GPIO Pin Configuration
{os.linesep.join(f'{pin}: {function}' for pin, function in gpio_pins.items())}
""".strip()

        # Create config files
        files_to_create = {
            f"{slug}/device.yaml": device_yaml,
            f"{slug}/config.yaml": yaml_config
        }

        for path, content in files_to_create.items():
            fork.create_file(
                path=path,
                message=f"Add {path} for {slug}",
                content=content,
                branch=branch_name
            )

        # Create pull request
        pr_body = f"""
# New Device Submission

## Device Information
- Name: {board_name}
- Chip: {chip_type}
- Tags: {', '.join(tags)}

## Description
{description}

{f'## Product Information{os.linesep}{product_link}' if product_link else ''}

## GPIO Configuration
{os.linesep.join(f'- {pin}: {function}' for pin, function in gpio_pins.items())}

## Images
{os.linesep.join(f'![{path.split("/")[-1]}]({path})' for path in image_paths)}
""".strip()

        pr = upstream.create_pull(
            title=f"Add device: {board_name}",
            body=pr_body,
            head=f"{user.login}:{branch_name}",
            base=BASE_BRANCH
        )

        return jsonify({
            'success': True,
            'pr_url': pr.html_url,
            'message': 'Pull request created successfully!'
        })

    except Exception as e:
        app.logger.error(f"Error creating pull request: {str(e)}")
        return jsonify({
            'error': f"Failed to create pull request: {str(e)}"
        }), 500

@app.route('/')
def index():
    return app.send_static_file('index.html')

if __name__ == '__main__':
    app.run(port=5003, debug=True)
