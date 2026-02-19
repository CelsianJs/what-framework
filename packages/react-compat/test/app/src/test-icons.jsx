/**
 * Test: react-icons — SVG icons from popular icon packs
 * 5M weekly downloads. Simple functional components returning SVG.
 */
import { FaReact, FaGithub, FaNpm, FaHeart, FaStar, FaCode } from 'react-icons/fa';
import { SiTypescript, SiVite, SiTailwindcss } from 'react-icons/si';

export function IconsTest() {
  return (
    <div>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <FaReact size={24} color="#61dafb" /> React
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <FaGithub size={24} /> GitHub
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <FaNpm size={24} color="#cc3534" /> npm
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <SiTypescript size={24} color="#3178c6" /> TypeScript
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <SiVite size={24} color="#646cff" /> Vite
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <SiTailwindcss size={24} color="#06b6d4" /> Tailwind
        </span>
      </div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <FaHeart color="#ef4444" size={20} />
        <FaStar color="#eab308" size={20} />
        <FaCode color="#8b5cf6" size={20} />
      </div>
      <p style={{ color: 'green' }} id="icons-status">React Icons loaded OK</p>
    </div>
  );
}
