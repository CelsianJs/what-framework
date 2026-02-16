export const inputStyle = 'width: 100%; padding: 0.75rem 1rem; background: #141414; border: 1px solid #2a2a2a; border-radius: 0.625rem; color: #e5e5e5; font-size: 0.875rem; outline: none; transition: border-color 0.2s, box-shadow 0.2s;';
export const labelStyle = 'display: block; font-size: 0.8125rem; font-weight: 500; color: #ccc; margin-bottom: 0.375rem;';
export const errorStyle = 'display: block; color: #fca5a5; font-size: 0.75rem; margin-top: 0.375rem;';

export const focusInput = (e) => {
  e.target.style.borderColor = '#3b82f6';
  e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.15)';
};

export const blurInput = (e, hasError) => {
  e.target.style.boxShadow = 'none';
  e.target.style.borderColor = hasError ? '#7f1d1d' : '#2a2a2a';
};
