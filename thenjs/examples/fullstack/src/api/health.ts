// GET /api/health — server health check
export function GET() {
  return Response.json({
    status: 'ok',
    framework: 'ThenJS',
    backend: 'CelsianJS',
    frontend: 'What Framework',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}
