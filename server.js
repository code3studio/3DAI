require('dotenv').config();  // Load .env => process.env.MESHY_API_KEY
const express = require('express');
const fetch = require('node-fetch'); // v2 for require() compatibility
const path = require('path');

// Optional: for streaming downloads, if you want to store to disk first
const fs = require('fs');

const app = express();
app.use(express.json());

// Serve static HTML, CSS, JS from /public
app.use(express.static(path.join(__dirname, 'public')));

/**
 * POST /api/preview
 * Creates a "preview" task (mesh only) from text prompt.
 */
app.post('/api/preview', async (req, res) => {
  try {
    const { prompt, art_style, should_remesh } = req.body;

    const previewBody = {
      mode: 'preview',
      prompt: prompt || '3D object',
      // Optionals:
      art_style: art_style || 'realistic',       // e.g. 'realistic' or 'sculpture'
      should_remesh: should_remesh !== false     // default true if not specified
    };

    const response = await fetch('https://api.meshy.ai/openapi/v2/text-to-3d', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MESHY_API_KEY}`
      },
      body: JSON.stringify(previewBody)
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    // { result: "preview_task_id" }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Error in /api/preview:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/refine
 * Creates a "refine" task (textured model) from a completed preview task.
 */
app.post('/api/refine', async (req, res) => {
  try {
    const { preview_task_id, enable_pbr } = req.body;

    if (!preview_task_id) {
      return res.status(400).json({ error: 'preview_task_id is required.' });
    }

    const refineBody = {
      mode: 'refine',
      preview_task_id,
      enable_pbr: enable_pbr === true
    };

    const response = await fetch('https://api.meshy.ai/openapi/v2/text-to-3d', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MESHY_API_KEY}`
      },
      body: JSON.stringify(refineBody)
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    // { result: "refine_task_id" }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Error in /api/refine:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/task/:taskId
 * Poll the status of any Text-to-3D task (preview or refine).
 */
app.get('/api/task/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;

    const response = await fetch(`https://api.meshy.ai/openapi/v2/text-to-3d/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.MESHY_API_KEY}`
      }
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    // Full task object
    const taskData = await response.json();
    res.json(taskData);
  } catch (err) {
    console.error('Error in /api/task/:taskId:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/download/:taskId
 * Download the final GLB model of a *completed* task.
 * Usually you’ll call this on the *refine* task ID for the textured model.
 */
app.get('/api/download/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;

    // 1. Get the task details from Meshy
    const response = await fetch(`https://api.meshy.ai/openapi/v2/text-to-3d/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.MESHY_API_KEY}`
      }
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Failed to fetch task info:', err);
      return res.status(response.status).send({ error: err });
    }

    const taskData = await response.json();
    if (taskData.status !== 'SUCCEEDED') {
      return res.status(400).json({ error: 'Task is not complete or has failed.' });
    }

    // 2. Extract the GLB URL from the task details
    const glbUrl = taskData.model_urls?.glb;
    if (!glbUrl) {
      return res.status(404).json({ error: 'GLB URL not found.' });
    }

    // 3. Fetch the GLB from the Meshy CDN
    const modelResponse = await fetch(glbUrl);
    if (!modelResponse.ok) {
      console.error('Failed to download GLB:', modelResponse.statusText);
      return res.status(500).json({ error: 'Failed to download GLB file.' });
    }

    // 4. Stream the GLB back to the client
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Content-Disposition', `attachment; filename="${taskId}.glb"`);
    modelResponse.body.pipe(res);
  } catch (err) {
    console.error('Error in /api/download/:taskId:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
