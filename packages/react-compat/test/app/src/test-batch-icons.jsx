/**
 * Batch test: Icon libraries + simple utility packages
 */
import React, { useState } from 'react';

class TB extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) return (
      <div style={{ border: '2px solid #f44', borderRadius: 8, padding: 12, margin: 8, background: '#2a0a0a' }}>
        <b style={{ color: '#f66' }}>FAIL: {this.props.name}</b>
        <pre style={{ color: '#f88', fontSize: 11, marginTop: 4, whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
      </div>
    );
    return (
      <div style={{ border: '2px solid #4f4', borderRadius: 8, padding: 12, margin: 8, background: '#0a2a0a' }}>
        <b style={{ color: '#4f4' }}>PASS: {this.props.name}</b>
        <div style={{ marginTop: 8 }}>{this.props.children}</div>
      </div>
    );
  }
}

// 1. @heroicons/react
import { BeakerIcon, ArrowRightIcon, HomeIcon } from '@heroicons/react/24/solid';
function T1() {
  return <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <BeakerIcon style={{ width: 24, height: 24, color: '#60a5fa' }} />
    <ArrowRightIcon style={{ width: 24, height: 24, color: '#34d399' }} />
    <HomeIcon style={{ width: 24, height: 24, color: '#f472b6' }} />
    <span>3 Heroicons rendered</span>
  </div>;
}

// 2. @phosphor-icons/react
import { Lightning, Heart, Star } from '@phosphor-icons/react';
function T2() {
  return <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <Lightning size={24} color="#fbbf24" weight="fill" />
    <Heart size={24} color="#f43f5e" weight="fill" />
    <Star size={24} color="#a78bfa" weight="fill" />
    <span>3 Phosphor icons rendered</span>
  </div>;
}

// 3. @radix-ui/react-icons
import { FaceIcon, GearIcon, RocketIcon } from '@radix-ui/react-icons';
function T3() {
  return <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <FaceIcon width={20} height={20} />
    <GearIcon width={20} height={20} />
    <RocketIcon width={20} height={20} />
    <span>3 Radix icons rendered</span>
  </div>;
}

// 4. react-qr-code
import QRCode from 'react-qr-code';
function T4() {
  return <div style={{ background: '#fff', padding: 8, display: 'inline-block', borderRadius: 4 }}>
    <QRCode value="https://github.com/zvndev/what-fw" size={80} />
  </div>;
}

// 5. react-loading-skeleton
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
function T5() {
  return <div style={{ width: 200 }}><Skeleton count={3} /><span>Skeleton rendered</span></div>;
}

// 6. react-spinners
import { ClipLoader, BeatLoader, PulseLoader } from 'react-spinners';
function T6() {
  return <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <ClipLoader size={20} color="#60a5fa" />
    <BeatLoader size={8} color="#34d399" />
    <PulseLoader size={8} color="#f472b6" />
    <span>3 spinners rendered</span>
  </div>;
}

// 7. react-intersection-observer
import { useInView } from 'react-intersection-observer';
function T7() {
  const { ref, inView } = useInView({ threshold: 0 });
  return <div ref={ref}>InView: {inView ? 'YES' : 'NO'} (hook works)</div>;
}

// 8. react-error-boundary
import { ErrorBoundary as REB } from 'react-error-boundary';
function T8() {
  return <REB fallback={<div>Fallback rendered</div>}><div>react-error-boundary wrapping works</div></REB>;
}

// 9. react-countup
import CountUp from 'react-countup';
function T9() {
  return <div>Count: <CountUp end={1000} duration={1} /></div>;
}

// 10. react-responsive
import { useMediaQuery } from 'react-responsive';
function T10() {
  const isDesktop = useMediaQuery({ minWidth: 768 });
  return <div>Is desktop (≥768px): {isDesktop ? 'YES' : 'NO'}</div>;
}

export default function BatchIcons() {
  return (
    <div style={{ fontFamily: 'system-ui', color: '#eee', background: '#111', padding: 16, minHeight: '100vh' }}>
      <h1 style={{ fontSize: 24, marginBottom: 16, color: '#60a5fa' }}>Batch: Icons & Utilities</h1>
      <TB name="@heroicons/react"><T1 /></TB>
      <TB name="@phosphor-icons/react"><T2 /></TB>
      <TB name="@radix-ui/react-icons"><T3 /></TB>
      <TB name="react-qr-code"><T4 /></TB>
      <TB name="react-loading-skeleton"><T5 /></TB>
      <TB name="react-spinners"><T6 /></TB>
      <TB name="react-intersection-observer"><T7 /></TB>
      <TB name="react-error-boundary"><T8 /></TB>
      <TB name="react-countup"><T9 /></TB>
      <TB name="react-responsive"><T10 /></TB>
    </div>
  );
}
