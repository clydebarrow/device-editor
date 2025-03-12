import { Octokit } from '@octokit/rest';
import { createHash } from 'crypto';

// Helper to generate session ID
const generateSessionId = () => crypto.randomUUID();

// Helper to handle responses
const jsonResponse = (data, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};

async function handleAuth(request, env) {
  const url = new URL(request.url);
  
  // GitHub OAuth flow start
  if (url.pathname === '/auth/github') {
    const sessionId = generateSessionId();
    const redirectUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&scope=repo`;
    
    // Store session
    await env.SESSIONS.put(sessionId, JSON.stringify({ pending: true }), { expirationTtl: 3600 });
    
    return new Response(null, {
      status: 302,
      headers: {
        'Location': redirectUrl,
        'Set-Cookie': `session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/`,
      },
    });
  }
  
  // GitHub OAuth callback
  if (url.pathname === '/auth/github/callback') {
    const code = url.searchParams.get('code');
    if (!code) {
      return jsonResponse({ error: 'No code provided' }, 400);
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
      return jsonResponse({ error: 'Failed to get access token' }, 400);
    }
    
    // Get session ID from cookie
    const cookie = request.headers.get('Cookie');
    const sessionId = cookie?.match(/session=([^;]+)/)?.[1];
    
    if (sessionId) {
      // Store token in session
      await env.SESSIONS.put(sessionId, JSON.stringify({ token: tokenData.access_token }), { expirationTtl: 3600 * 24 });
    }
    
    return new Response(null, {
      status: 302,
      headers: { 'Location': '/' },
    });
  }
  
  return null;
}

async function handleCheckAuth(request, env) {
  const cookie = request.headers.get('Cookie');
  const sessionId = cookie?.match(/session=([^;]+)/)?.[1];
  
  if (!sessionId) {
    return jsonResponse({ authenticated: false });
  }
  
  const sessionData = await env.SESSIONS.get(sessionId);
  if (!sessionData) {
    return jsonResponse({ authenticated: false });
  }
  
  const session = JSON.parse(sessionData);
  if (!session.token) {
    return jsonResponse({ authenticated: false });
  }
  
  // Get user info from GitHub
  try {
    const octokit = new Octokit({ auth: session.token });
    const { data: user } = await octokit.users.getAuthenticated();
    
    return jsonResponse({
      authenticated: true,
      username: user.login,
      avatar_url: user.avatar_url,
    });
  } catch (error) {
    // Clear invalid session
    await env.SESSIONS.delete(sessionId);
    return jsonResponse({ authenticated: false });
  }
}

async function handleLogout(request, env) {
  const cookie = request.headers.get('Cookie');
  const sessionId = cookie?.match(/session=([^;]+)/)?.[1];
  
  if (sessionId) {
    await env.SESSIONS.delete(sessionId);
  }
  
  return jsonResponse({ success: true });
}

async function handleSubmitDevice(request, env) {
  const cookie = request.headers.get('Cookie');
  const sessionId = cookie?.match(/session=([^;]+)/)?.[1];
  
  if (!sessionId) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }
  
  const sessionData = await env.SESSIONS.get(sessionId);
  if (!sessionData) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }
  
  const session = JSON.parse(sessionData);
  if (!session.token) {
    return jsonResponse({ error: 'Authentication required' }, 401);
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
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }
    
    const octokit = new Octokit({ auth: session.token });
    
    // Get user and upstream repo info
    const user = await octokit.users.getAuthenticated();
    const [owner, repo] = env.UPSTREAM_REPO.split('/');
    
    // Fork repository if not already forked
    try {
      await octokit.repos.get({
        owner: user.data.login,
        repo,
      });
    } catch {
      await octokit.repos.createFork({
        owner,
        repo,
      });
    }
    
    // Generate branch name
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const shortId = Math.random().toString(36).substring(2, 10);
    const branchName = `device/${slug}-${shortId}-${timestamp}`;
    
    // Get base branch reference
    const { data: baseRef } = await octokit.git.getRef({
      owner,
      repo,
      ref: 'heads/dev',
    });
    
    // Create new branch
    await octokit.git.createRef({
      owner: user.data.login,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseRef.object.sha,
    });
    
    // Process images
    const imagePaths = [];
    for (const [key, file] of formData.entries()) {
      if (key.startsWith('image') && file instanceof File) {
        const filename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const imagePath = `${slug}/images/${filename}`;
        imagePaths.push(imagePath);
        
        const arrayBuffer = await file.arrayBuffer();
        const base64Content = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        
        await octokit.repos.createOrUpdateFileContents({
          owner: user.data.login,
          repo,
          path: imagePath,
          message: `Add image ${filename} for ${slug}`,
          content: base64Content,
          branch: branchName,
        });
      }
    }
    
    // Create device.yaml
    const deviceYaml = [
      `chip: ${chipType.toLowerCase()}`,
      `board: ${slug}`,
      `name: ${boardName}`,
      '',
      '# Board Description',
      `description: ${description}`,
      '',
      '# Tags',
      `tags: ${tags.join(', ')}`,
      '',
      '# GPIO Pin Configuration',
      ...Object.entries(gpioPins).map(([pin, func]) => `${pin}: ${func}`),
    ].join('\n');
    
    // Create files
    const files = {
      [`${slug}/device.yaml`]: deviceYaml,
      [`${slug}/config.yaml`]: yamlConfig,
    };
    
    for (const [path, content] of Object.entries(files)) {
      await octokit.repos.createOrUpdateFileContents({
        owner: user.data.login,
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
      head: `${user.data.login}:${branchName}`,
      base: 'dev',
    });
    
    return jsonResponse({
      success: true,
      pr_url: pr.html_url,
    });
  } catch (error) {
    console.error('Error submitting device:', error);
    return jsonResponse({ error: 'Failed to submit device' }, 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
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
      return jsonResponse({ error: 'Internal server error' }, 500);
    }
  },
};
