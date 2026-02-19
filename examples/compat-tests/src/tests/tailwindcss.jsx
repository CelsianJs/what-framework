function TestComponent() {
  return (
    <div>
      <div className="bg-blue-500 text-white p-4 rounded-lg">
        Tailwind works
      </div>
      <div className="mt-2 flex gap-2">
        <span className="bg-green-500 text-white px-2 py-1 rounded text-sm">Green</span>
        <span className="bg-red-500 text-white px-2 py-1 rounded text-sm">Red</span>
        <span className="bg-purple-500 text-white px-2 py-1 rounded text-sm">Purple</span>
      </div>
      <p className="mt-2 text-gray-400 text-xs italic">
        If you see colored badges above, Tailwind CSS is working.
      </p>
    </div>
  );
}

TestComponent.packageName = 'tailwindcss';
TestComponent.downloads = '40M/week';
export default TestComponent;
