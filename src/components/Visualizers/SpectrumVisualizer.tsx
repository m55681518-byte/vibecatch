import React, { useEffect, useRef } from 'react';
import { VisualizerMode } from '../../types';
import { audioEngine } from '../../services/audioEngine';

interface SpectrumVisualizerProps {
  mode: VisualizerMode;
  isPlaying: boolean;
}

export const SpectrumVisualizer: React.FC<SpectrumVisualizerProps> = ({ mode, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const peaksRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1));
    let height = (canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1));

    const bufferLength = 64;
    const freqData = new Uint8Array(bufferLength);
    const timeData = new Uint8Array(bufferLength);

    if (peaksRef.current.length !== bufferLength) {
      peaksRef.current = new Array(bufferLength).fill(0);
    }

    // Floating particles for particle burst mode
    const particles = Array.from({ length: 45 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 3 + 1,
      speedX: (Math.random() - 0.5) * 1.5,
      speedY: (Math.random() - 0.5) * 1.5,
      hue: Math.random() > 0.5 ? 320 : 190,
      opacity: Math.random() * 0.7 + 0.3,
    }));

    let rotationAngle = 0;

    const render = () => {
      if (document.hidden) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      width = canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1);
      height = canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1);

      ctx.clearRect(0, 0, width, height);

      if (isPlaying) {
        audioEngine.getAnalyserData(freqData);
        audioEngine.getTimeDomainData(timeData);
      } else {
        // Subtle resting wave
        for (let i = 0; i < bufferLength; i++) {
          freqData[i] = Math.max(0, freqData[i] * 0.94);
          timeData[i] = 128;
        }
      }

      // ==================== MODE 1: SPECTRUM BARS ====================
      if (mode === 'spectrum') {
        const barCount = 42;
        const totalGap = (barCount - 1) * 6;
        const barWidth = Math.max(4, (width - totalGap - 40) / barCount);
        const startX = 20;

        for (let i = 0; i < barCount; i++) {
          const val = freqData[i % bufferLength] / 255;
          const barHeight = Math.max(6, val * (height * 0.65));
          const x = startX + i * (barWidth + 6);
          const y = height * 0.75 - barHeight;

          // Peak fall-off
          if (val > (peaksRef.current[i] || 0)) {
            peaksRef.current[i] = val;
          } else {
            peaksRef.current[i] = Math.max(0, (peaksRef.current[i] || 0) - 0.015);
          }

          // Bar Gradient
          const gradient = ctx.createLinearGradient(x, y, x, height * 0.75);
          gradient.addColorStop(0, '#ff007f'); // Hot pink top
          gradient.addColorStop(0.5, '#db2777');
          gradient.addColorStop(1, '#00f2fe'); // Neon cyan base

          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, [4, 4, 0, 0]);
          ctx.fill();

          // Peak Dot
          const peakY = height * 0.75 - (peaksRef.current[i] || 0) * (height * 0.65) - 6;
          ctx.fillStyle = '#00f2fe';
          ctx.beginPath();
          ctx.arc(x + barWidth / 2, peakY, Math.min(3, barWidth / 2), 0, Math.PI * 2);
          ctx.fill();

          // Subtle reflection below
          const reflGradient = ctx.createLinearGradient(x, height * 0.75, x, height * 0.75 + barHeight * 0.35);
          reflGradient.addColorStop(0, 'rgba(0, 242, 254, 0.25)');
          reflGradient.addColorStop(1, 'rgba(0, 242, 254, 0)');
          ctx.fillStyle = reflGradient;
          ctx.beginPath();
          ctx.roundRect(x, height * 0.75 + 2, barWidth, barHeight * 0.35, [0, 0, 4, 4]);
          ctx.fill();
        }
      }

      // ==================== MODE 2: NEON WAVEFORM ====================
      else if (mode === 'waveform') {
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = '#00f2fe';
        ctx.shadowColor = '#00f2fe';
        ctx.shadowBlur = 15;

        ctx.beginPath();
        const sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = timeData[i] / 128.0;
          const y = (v * height) / 2;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }

        ctx.stroke();

        // Second Pink Wave Accent
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ff007f';
        ctx.shadowColor = '#ff007f';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const freqFactor = (freqData[i] / 255) * 40;
          const v = (timeData[i] / 128.0);
          const y = (v * height) / 2 + Math.sin(i * 0.2 + Date.now() * 0.005) * freqFactor;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // ==================== MODE 3: RADIAL CYBER PULSE ====================
      else if (mode === 'radial') {
        const centerX = width / 2;
        const centerY = height / 2;
        const bassLevel = (freqData[0] + freqData[1] + freqData[2]) / (3 * 255);
        const baseRadius = Math.min(width, height) * 0.22 + bassLevel * 20;

        rotationAngle += 0.008;

        // Inner glowing orb
        const orbGrad = ctx.createRadialGradient(centerX, centerY, 5, centerX, centerY, baseRadius);
        orbGrad.addColorStop(0, 'rgba(255, 0, 127, 0.4)');
        orbGrad.addColorStop(0.7, 'rgba(0, 242, 254, 0.2)');
        orbGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = orbGrad;
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
        ctx.fill();

        // Radial Frequency Rays
        const numRays = 48;
        for (let i = 0; i < numRays; i++) {
          const angle = (i / numRays) * Math.PI * 2 + rotationAngle;
          const val = freqData[i % bufferLength] / 255;
          const rayLen = 10 + val * 70;

          const x1 = centerX + Math.cos(angle) * baseRadius;
          const y1 = centerY + Math.sin(angle) * baseRadius;
          const x2 = centerX + Math.cos(angle) * (baseRadius + rayLen);
          const y2 = centerY + Math.sin(angle) * (baseRadius + rayLen);

          ctx.strokeStyle = i % 2 === 0 ? '#00f2fe' : '#ff007f';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }

      // ==================== MODE 4: PARTICLE BURST ====================
      else if (mode === 'particles') {
        const bass = (freqData[0] + freqData[1]) / (2 * 255);

        particles.forEach((p) => {
          p.x += p.speedX * (1 + bass * 3);
          p.y += p.speedY * (1 + bass * 3);

          if (p.x < 0) p.x = width;
          if (p.x > width) p.x = 0;
          if (p.y < 0) p.y = height;
          if (p.y > height) p.y = 0;

          const currentRadius = p.radius * (1 + bass * 1.8);
          ctx.fillStyle = `hsla(${p.hue}, 100%, 65%, ${p.opacity})`;
          ctx.shadowColor = `hsla(${p.hue}, 100%, 65%, 0.8)`;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(p.x, p.y, currentRadius, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.shadowBlur = 0;
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [mode, isPlaying]);

  return (
    <div className="w-full h-full relative flex items-center justify-center p-2">
      <canvas ref={canvasRef} className="w-full h-full max-h-[360px] object-contain rounded-2xl" />
    </div>
  );
};
