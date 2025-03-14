import jwt from "@tsndr/cloudflare-worker-jwt"
const { Octokit } = require("@octokit/rest");


// Helper to generate session ID
const generateSessionId = () => crypto.randomUUID();

// Helper to handle responses
const jsonResponse = (data, status = 200, request, error = null) => {
  const origin = request.headers.get('Origin') || '*';
  const responseData = { ...data };
  if (error) {
    responseData.errorDetail = error.message || error.toString();
  }
  return new Response(JSON.stringify(responseData), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Cookie',
      'Access-Control-Allow-Credentials': 'true',
    },
  });
};


async function generateJWT(env) {

  const now = Math.floor(Date.now() / 1000);


  const token = await jwt.sign({
    iat: now, // Issued at
    exp: now + 300, // Expires in 5 minutes
    iss: env.GITHUB_CLIENT_ID, // GitHub App ID
    alg: "RS256",
  }, env.PRIVATE_KEY, { algorithm: 'RS256' });
  return token;
}

let cachedToken = null;
let tokenExpiresAt = 0;

async function getInstallationToken(env) {

  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

// Step 1: Generate JWT
  const jwt = await generateJWT(env)

// Step 2: Authenticate Octokit with the JWT
  const appOctokit = new Octokit({ auth: jwt });

// Step 3: Get Installation ID
  const { data: installations } = await appOctokit.request("GET /app/installations");
  if (installations.length === 0) {
    throw new Error("No installation found for this GitHub App.");
  }
  const installationId = installations[0].id;

// Step 4: Generate Installation Token
  const { data: tokenData } = await appOctokit.request(
      "POST /app/installations/{installation_id}/access_tokens",
      { installation_id: installationId }
  );
  const installationToken = tokenData.token;

  cachedToken = installationToken;
    tokenExpiresAt = Date.now() + 1000 * 59 * 60; // less than 1 hour

  return installationToken;
}



async function handleAuth(request, env) {
  const url = new URL(request.url);
  
  // GitHub OAuth flow start
  if (url.pathname === '/auth/github') {
    const sessionId = generateSessionId();
    const origin = new URL(request.url).origin;
    const returnTo = url.searchParams.get('returnTo') || '/';
    
    const redirectUrl = new URL('https://github.com/login/oauth/authorize');
    redirectUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
    redirectUrl.searchParams.set('scope', 'repo');
    redirectUrl.searchParams.set('redirect_uri', `${origin}/auth/github/callback`);
    redirectUrl.searchParams.set('state', btoa(JSON.stringify({ returnTo })));
    
    // Store session
    if (!env.SESSIONS) {
      console.error('SESSIONS KV namespace is not defined');
      return jsonResponse({ error: 'Server configuration error' }, 500, request, new Error('SESSIONS KV namespace is not defined'));
    }
    await env.SESSIONS.put(sessionId, JSON.stringify({ pending: true, returnTo }), { expirationTtl: 3600 });
    
    return new Response(null, {
      status: 302,
      headers: {
        'Location': redirectUrl.toString(),
        'Set-Cookie': `session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/`,
      },
    });
  }
  
  // GitHub OAuth callback
  if (url.pathname === '/auth/github/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code) {
      return jsonResponse({ error: 'No code provided' }, 400, request, new Error('No code provided'));
    }
    
    let returnTo = '/';
    try {
      const stateData = JSON.parse(atob(state));
      returnTo = stateData.returnTo;
    } catch (e) {
      console.error('Failed to parse state:', e);
    }
    
    // Exchange code for token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    
    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      return jsonResponse({ error: 'Failed to get access token' }, 400, request, new Error('Failed to get access token'));
    }
    
    // Get session ID from cookie
    const cookie = request.headers.get('Cookie');
    const sessionId = cookie?.match(/session=([^;]+)/)?.[1];
    
    if (sessionId) {
      // Store token in session
      if (!env.SESSIONS) {
        console.error('SESSIONS KV namespace is not defined');
        return jsonResponse({ error: 'Server configuration error' }, 500, request, new Error('SESSIONS KV namespace is not defined'));
      }
      console.log('Storing session token for:', sessionId);
      await env.SESSIONS.put(sessionId, JSON.stringify({ token: tokenData.access_token }), { expirationTtl: 3600 * 24 });
    }
    
    return new Response(null, {
      status: 302,
      headers: { 
        'Location': `${returnTo}`,
        'Set-Cookie': `session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/`
      },
    });
  }
  
  return null;
}

async function handleCheckAuth(request, env) {
  const cookie = request.headers.get('Cookie');
  const sessionId = cookie?.match(/session=([^;]+)/)?.[1];
  
  if (!sessionId) {
    return jsonResponse({ authenticated: false }, 200, request);
  }
  
  if (!env.SESSIONS) {
    console.error('SESSIONS KV namespace is not defined');
    return jsonResponse({ error: 'Server configuration error' }, 500, request, new Error('SESSIONS KV namespace is not defined'));
  }

  console.log('Checking session:', sessionId);
  const  sessionData = await env.SESSIONS.get(sessionId);

  if (!sessionData) {
    console.log('No session data found');
    return jsonResponse({ authenticated: false }, 200, request);
  }
  
  const session = JSON.parse(sessionData);
  if (!session.token) {
    return jsonResponse({ authenticated: false }, 200, request);
  }

  // Get user info from GitHub
  try {
    const octokit = new Octokit({ auth: session.token });

    const user = await octokit.users.getAuthenticated();
    
    return jsonResponse({
      authenticated: true,
      username: user.data.login,
      avatar_url: user.data.avatar_url,
    }, 200, request);
  } catch (error) {
    console.log('Error checking auth:', error);
    // Clear invalid session
    await env.SESSIONS.delete(sessionId);
    return jsonResponse({ authenticated: false }, 200, request, error);
  }
}

async function handleLogout(request, env) {
  const cookie = request.headers.get('Cookie');
  const sessionId = cookie?.match(/session=([^;]+)/)?.[1];
  const origin = request.headers.get('Origin') || '*';

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Cookie',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
      }
    });
  }

  // Only allow POST method
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true'
        }
      });
    }

    if (sessionId && env.SESSIONS) {
      console.log('Logging out session:', sessionId);
      await env.SESSIONS.delete(sessionId);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'Set-Cookie': 'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Cookie'
      }
    });
  }

async function handleCheckSlug(request, env) {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');
  
  if (!slug) {
    return jsonResponse({ error: 'No slug provided' }, 400, request);
  }

  try {
    // Get installation token for the GitHub App
    const token = await getInstallationToken(env);
    const octokit = new Octokit({ auth: token });

    // Check if the content/devices/<slug> directory exists in the repo
    const [owner, repo] = env.UPSTREAM_REPO.split('/');
    try {
      await octokit.rest.repos.getContent({
        owner: owner,
        repo: repo,
        path: `content/devices/${slug}`
      });
      // If we get here, the directory exists
      console.log(`Slug ${slug} is not available`);
      return jsonResponse({ available: false }, 200, request);
    } catch (error) {
      if (error.status === 404) {
        // Directory doesn't exist, slug is available
        return jsonResponse({ available: true }, 200, request);
      }
      throw error; // Re-throw other errors
    }
  } catch (error) {
    console.error('Error checking slug availability:', error);
    return jsonResponse({ error: 'Failed to check slug availability' }, 500, request, error);
  }
}

async function handleSubmitDevice(request, env) {
  const cookie = request.headers.get('Cookie');
  const sessionId = cookie?.match(/session=([^;]+)/)?.[1];

  if (!sessionId) {
    return jsonResponse({error: 'Authentication required'}, 401, request);
  }

  const sessionData = await env.SESSIONS.get(sessionId);
  if (!sessionData) {
    return jsonResponse({error: 'Authentication required'}, 401, request, new Error('No session data found'));
  }

  const session = JSON.parse(sessionData);
  if (!session.token) {
    return jsonResponse({error: 'Authentication required'}, 401, request, new Error('No token in session'));
  }

  try {
    const formData = await request.formData();
    const slug = formData.get('slug');
    const boardName = formData.get('boardName');
    const description = formData.get('description');
    const chipType = formData.get('chipType');
    const productLink = formData.get('productLink');
    const gpioPins = JSON.parse(formData.get('gpioPins') || '{}');
    const tags = formData.get('tags')?.split(',') || [];
    const yamlConfig = formData.get('yamlConfig');

    // Validate required fields
    if (!slug || !boardName || !description || !chipType || !gpioPins || !tags.length || !yamlConfig) {
      return jsonResponse({error: 'Missing required fields'}, 400, request);
    }
    const folder = 'content/devices/' + slug;

    const octokit = new Octokit({
      auth: await getInstallationToken(env),
    });


    const [owner, repo] = env.UPSTREAM_REPO.split('/');

    // Generate branch name
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const shortId = Math.random().toString(36).substring(2, 10);
    const branchName = `${slug}-${shortId}-${timestamp}`;

    // Get base branch reference
    const {data: baseRef} = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${env.BASE_BRANCH || 'main'}`,
    });

    // Check if branch already exists
    try {
      await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${branchName}`,
      });
      return jsonResponse({error: `Branch ${branchName} already exists`}, 400, request);
    } catch (error) {
      if (error.status !== 404) {
        console.error('Error checking branch existence:', error);
        return jsonResponse({error: 'Internal server error'}, 500, request, error);
      }
    }

    // Create new branch
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseRef.object.sha,
    });

    // Process images
    for (const [key, file] of formData.entries()) {
      if (key.startsWith('image') && file instanceof File) {
        const filename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const imagePath = `${folder}/images/${filename}`;

        const arrayBuffer = await file.arrayBuffer();
        const base64Content = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

        await octokit.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: imagePath,
          message: `Add image ${filename} for ${slug}`,
          content: base64Content,
          branch: branchName,
        });
      }
    }

    // Create device markdown file
    const deviceMarkdown = [
      `---`,
      `chip: ${chipType}`,
      `board: ${slug}`,
      `name: ${boardName}`,
      `product_link: ${productLink}`,
      `tags: [${tags.join(', ')}]`,
      `gpio_pins:`,
      ...Object.entries(gpioPins).map(([pin, func]) => `  ${pin}: ${func}`),
      `---`,
      '',
      description,
    ].join('\n');

    // Create files
    const files = {
      [`${folder}/device.md`]: deviceMarkdown,
      [`${folder}/config.yaml`]: yamlConfig,
    };

    for (const [path, content] of Object.entries(files)) {
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: `Add ${path} for ${slug}`,
        content: Buffer.from(content).toString('base64'),
        branch: branchName,
      });
    }

    // Create pull request
    const {data: pr} = await octokit.pulls.create({
      owner,
      repo,
      title: `Add device: ${boardName}`,
      body: `Add support for ${boardName}\n\n${description}`,
      head: branchName,
      base: env.BASE_BRANCH || 'main',
    });

    // Create response with success data and clear localStorage script
    return jsonResponse({success: true, pr_url: pr.html_url}, 200, request);
  } catch (error) {
    console.error('Error submitting device:', error);
    return jsonResponse({error: 'Failed to submit device'}, 500, request, error);
  }
}

export default {
  async fetch(request, env, _) {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin') || '*';
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Cookie, Authorization',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
          'Vary': 'Origin'
        },
      });
    }

    // Route requests
    const url = new URL(request.url);

    try {
      // Auth routes
      if (url.pathname.startsWith('/auth/')) {
        if (url.pathname === '/auth/check') {
          return await handleCheckAuth(request, env);
        }
        if (url.pathname === '/auth/logout') {
          return await handleLogout(request, env);
        }
        const authResponse = await handleAuth(request, env);
        if (authResponse) return authResponse;
      }

      // Device submission
      if (url.pathname === '/submit' && request.method === 'POST') {
        return await handleSubmitDevice(request, env);
      }

      // Check slug availability
      if (url.pathname === '/checkSlug' && request.method === 'GET') {
        return await handleCheckSlug(request, env);
      }

      // Serve static files or handle other routes here
      return new Response('Not found', {status: 404});
    } catch (error) {
      console.error('Error handling request:', error);
      return jsonResponse({error: 'Internal server error'}, 500, request, error);
    }
  },
}
