import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseAnimationPlayerOptions {
  totalSteps: number;
  autoPlayDelay?: number;
  loop?: boolean;
}

export function useAnimationPlayer({
  totalSteps,
  autoPlayDelay = 1800,
  loop = false,
}: UseAnimationPlayerOptions) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playingRef = useRef(false);
  const stepRef = useRef(0);
  const speedRef = useRef(1);
  const totalRef = useRef(totalSteps);

  useEffect(() => {
    totalRef.current = totalSteps;
    // 步骤总数变化时重置到起点（切换模板/动画时）
    stepRef.current = 0;
    setCurrentStep(0);
    playingRef.current = false;
    setIsPlaying(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [totalSteps]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pause = useCallback(() => {
    playingRef.current = false;
    setIsPlaying(false);
    clearTimer();
  }, [clearTimer]);

  const advance = useCallback(() => {
    const next = stepRef.current + 1;
    if (next >= totalRef.current) {
      if (loop) {
        stepRef.current = 0;
        setCurrentStep(0);
      } else {
        stepRef.current = totalRef.current - 1;
        setCurrentStep(totalRef.current - 1);
        playingRef.current = false;
        setIsPlaying(false);
        clearTimer();
      }
      return;
    }
    stepRef.current = next;
    setCurrentStep(next);
  }, [loop, clearTimer]);

  const tick = useCallback(() => {
    if (!playingRef.current) return;
    advance();
    if (!playingRef.current) return;
    timerRef.current = setTimeout(tick, autoPlayDelay / speedRef.current);
  }, [advance, autoPlayDelay]);

  const play = useCallback(() => {
    if (playingRef.current) return;
    if (stepRef.current >= totalRef.current - 1) {
      stepRef.current = 0;
      setCurrentStep(0);
    }
    playingRef.current = true;
    setIsPlaying(true);
    timerRef.current = setTimeout(tick, autoPlayDelay / speedRef.current);
  }, [tick, autoPlayDelay]);

  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [pause, play]);

  const step = useCallback(() => {
    pause();
    advance();
  }, [pause, advance]);

  const stepBack = useCallback(() => {
    pause();
    if (stepRef.current > 0) {
      stepRef.current -= 1;
      setCurrentStep(stepRef.current);
    }
  }, [pause]);

  const reset = useCallback(() => {
    pause();
    stepRef.current = 0;
    setCurrentStep(0);
  }, [pause]);

  const goTo = useCallback(
    (i: number) => {
      pause();
      const clamped = Math.max(0, Math.min(i, totalRef.current - 1));
      stepRef.current = clamped;
      setCurrentStep(clamped);
    },
    [pause],
  );

  const changeSpeed = useCallback((s: number) => {
    speedRef.current = s;
    setSpeed(s);
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return {
    currentStep,
    isPlaying,
    speed,
    totalSteps,
    play,
    pause,
    toggle,
    step,
    stepBack,
    reset,
    goTo,
    setSpeed: changeSpeed,
  };
}
