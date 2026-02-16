export async function GET() {
  return Response.json([
    { id: '1', name: 'Alice' },
    { id: '2', name: 'Bob' },
  ]);
}

export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ id: '3', ...body }, { status: 201 });
}
