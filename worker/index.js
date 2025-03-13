import jwt from "@tsndr/cloudflare-worker-jwt"
const { Octokit } = require("@octokit/rest");
const forge = require('node-forge');



// Helper to generate session ID
const generateSessionId = () => crypto.randomUUID();

// Helper to handle responses
const jsonResponse = (data, status = 200, request) => {
  const origin = request.headers.get('Origin') || '*';
  return new Response(JSON.stringify(data), {
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
  console.log(token);
  return token;
}

let cachedToken = null;
let tokenExpiresAt = 0;

async function getInstallationToken(env) {

  if (cachedToken && Date.now() < tokenExpiresAt) {
    console.log("Using cached token");
    return cachedToken;
  }

// Step 1: Generate JWT
  const jwt = await generateJWT(env)
  console.log("Generated JWT:", jwt);

// Step 2: Authenticate Octokit with the JWT
  const appOctokit = new Octokit({ auth: jwt });

// Step 3: Get Installation ID
  const { data: installations } = await appOctokit.request("GET /app/installations");
  if (installations.length === 0) {
    throw new Error("No installation found for this GitHub App.");
  }
  const installationId = installations[0].id;
  console.log("Installation ID:", installationId);

// Step 4: Generate Installation Token
  const { data: tokenData } = await appOctokit.request(
      "POST /app/installations/{installation_id}/access_tokens",
      { installation_id: installationId }
  );
  const installationToken = tokenData.token;
  console.log("Installation Token:", installationToken);

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
      return jsonResponse({ error: 'Server configuration error' }, 500, request);
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
      return jsonResponse({ error: 'No code provided' }, 400, request);
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
      return jsonResponse({ error: 'Failed to get access token' }, 400, request);
    }
    
    // Get session ID from cookie
    const cookie = request.headers.get('Cookie');
    const sessionId = cookie?.match(/session=([^;]+)/)?.[1];
    
    if (sessionId) {
      // Store token in session
      if (!env.SESSIONS) {
        console.error('SESSIONS KV namespace is not defined');
        return jsonResponse({ error: 'Server configuration error' }, 500, request);
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
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  console.log('Checking session:', sessionId);
  const  sessionData = await env.SESSIONS.get(sessionId);
  console.log('Session data:', sessionData);

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
    const octokit = new Octokit({
      auth: await getInstallationToken(env),
    });

    const user = await octokit.users.getAuthenticated();
    
    return jsonResponse({
      authenticated: true,
      username: user.data.login,
      avatar_url: user.data.avatar_url,
    }, 200, request);
  } catch (error) {
    // Clear invalid session
    await env.SESSIONS.delete(sessionId);
    return jsonResponse({ authenticated: false }, 200, request);
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
      status: 405,
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

async function handleSubmitDevice(request, env) {
  const cookie = request.headers.get('Cookie');
  const sessionId = cookie?.match(/session=([^;]+)/)?.[1];
  
  if (!sessionId) {
    return jsonResponse({ error: 'Authentication required' }, 401, request);
  }
  
  const sessionData = await env.SESSIONS.get(sessionId);
  if (!sessionData) {
    return jsonResponse({ error: 'Authentication required' }, 401, request);
  }
  
  const session = JSON.parse(sessionData);
  if (!session.token) {
    return jsonResponse({ error: 'Authentication required' }, 401, request);
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
      return jsonResponse({ error: 'Missing required fields' }, 400, request);
    }

    const octokit = new Octokit({
      auth: await getInstallationToken(env),
    });


    const [owner, repo] = env.UPSTREAM_REPO.split('/');

    // Generate branch name
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const shortId = Math.random().toString(36).substring(2, 10);
    const branchName = `device/${slug}-${shortId}-${timestamp}`;
    
    // Get base branch reference
    const { data: baseRef } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${env.BASE_BRANCH || 'dev'}`,
    });
    
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
        const imagePath = `${slug}/images/${filename}`;

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
      `chip: ${chipType.toLowerCase()}`,
      `board: ${slug}`,
      `name: ${boardName}`,
      `product_link: ${productLink}`,
      `tags: ${tags.join(', ')}`,
      '',
      '# Board Description',
      description,
      '',
      '# GPIO Pin Configuration',
      ...Object.entries(gpioPins).map(([pin, func]) => `${pin}: ${func}`),
    ].join('\n');
    
    // Create files
    const files = {
      [`${slug}/device.md`]: deviceMarkdown,
      [`${slug}/config.yaml`]: yamlConfig,
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
    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title: `Add device: ${boardName}`,
      body: `Add support for ${boardName}\n\n${description}`,
      head: branchName,
      base: env.BASE_BRANCH || 'main',
    });
    
    // Create response with success data and clear localStorage script
    const responseHtml = `
      <script>
        // Clear form data from localStorage
        localStorage.removeItem('deviceEditorFormData');
        
        // Notify parent window of success
        window.parent.postMessage({
          type: 'submitSuccess',
          data: {
            success: true,
            pr_url: '${pr.html_url}'
          }
        }, '*');
      </script>
    `;
    
    return new Response(responseHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
        'Access-Control-Allow-Credentials': 'true'
      }
    });
  } catch (error) {
    console.error('Error submitting device:', error);
    return jsonResponse({ error: 'Failed to submit device' }, 500, request);
  }
}

export default {
  async fetch(request, env, ctx) {
    // Debug environment bindings
    console.log('Environment bindings:', {
      hasKV: !!env.SESSIONS,
      envKeys: Object.keys(env)
    });
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
      
      // Serve static files or handle other routes here
      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('Error handling request:', error);
      return jsonResponse({ error: 'Internal server error' }, 500, request);
    }
  },
};
