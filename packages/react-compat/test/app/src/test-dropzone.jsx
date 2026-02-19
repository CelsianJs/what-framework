import { useDropzone } from 'react-dropzone';
import { useState } from 'react';

export function DropzoneTest() {
  const [files, setFiles] = useState([]);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: accepted => setFiles(accepted.map(f => f.name)),
    accept: { 'image/*': ['.png', '.jpg', '.gif'] },
  });

  return (
    <div>
      <div {...getRootProps()} style={{
        border: '2px dashed ' + (isDragActive ? '#3b82f6' : '#666'),
        borderRadius: '8px',
        padding: '24px',
        textAlign: 'center',
        cursor: 'pointer',
        background: isDragActive ? '#3b82f610' : 'transparent',
        transition: 'all 0.2s',
      }}>
        <input {...getInputProps()} />
        {isDragActive
          ? <p>Drop files here...</p>
          : <p>Drag & drop images here, or click to select</p>
        }
      </div>
      {files.length > 0 && (
        <ul style={{ marginTop: '8px' }}>
          {files.map(f => <li key={f}>{f}</li>)}
        </ul>
      )}
      <p style={{ color: 'green', marginTop: '4px' }}>react-dropzone with useDropzone hook</p>
    </div>
  );
}
