// react-dropzone: a drop area whose accepted files go to the native page.
import { useDropzone } from 'react-dropzone';
import { useProbe } from './probe.js';

export function Dropzone({ onFiles }) {
  useProbe('dropzone');
  const { getRootProps, getInputProps, isDragActive, acceptedFiles } = useDropzone({
    accept: { 'text/csv': ['.csv'] },
    onDrop: (accepted, rejected) => onFiles(accepted.map((f) => ({ name: f.name, size: f.size })), rejected.length),
  });
  return (
    <div {...getRootProps({ className: 'dropzone' })} data-dropzone>
      <input data-dropzone-input {...getInputProps()} />
      <p>{isDragActive ? 'Drop the trade file here' : 'Drop a CSV of trades, or click to choose one'}</p>
      <span data-dropzone-accepted>{acceptedFiles.length}</span>
    </div>
  );
}
