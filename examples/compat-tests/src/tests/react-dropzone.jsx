import { useDropzone } from 'react-dropzone';
import { useCallback } from 'react';

function TestComponent() {
  const onDrop = useCallback((acceptedFiles) => {
    console.log('Dropped files:', acceptedFiles);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  return (
    <div
      {...getRootProps()}
      style={{
        border: '2px dashed ' + (isDragActive ? '#22c55e' : '#555'),
        borderRadius: 8,
        padding: '20px 12px',
        textAlign: 'center',
        cursor: 'pointer',
        background: isDragActive ? '#22c55e10' : 'transparent',
        transition: 'all 0.2s',
      }}
    >
      <input {...getInputProps()} />
      {isDragActive
        ? <p style={{ color: '#22c55e', margin: 0 }}>Drop files here...</p>
        : <p style={{ color: '#888', margin: 0 }}>Drag & drop files here, or click to select</p>
      }
    </div>
  );
}

TestComponent.packageName = 'react-dropzone';
TestComponent.downloads = '7.2M/week';
export default TestComponent;
