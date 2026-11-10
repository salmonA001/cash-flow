'use client';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Controls, type PlaygroundSettings } from './controls';
import { FluidScene, type FluidSceneHandle } from './fluid-scene';

const DEFAULTS: PlaygroundSettings = { gravity: 9.8, viscosity: 0.1, limit: 5000, tiltX: 0, tiltZ: 0 };

export function Playground() {
  const scene = useRef<FluidSceneHandle>(null);
  const [settings, setSettings] = useState(DEFAULTS);
  const [paused, setPaused] = useState(false);
  const [pouring, setPouring] = useState(false);
  const [count, setCount] = useState(0);

  return (
    <main className="flex h-dvh flex-col lg:flex-row">
      <div className="relative min-h-0 flex-1">
        <FluidScene ref={scene} {...settings} paused={paused} pouring={pouring} onCountChange={setCount} />
      </div>
      <Card className="m-3 shrink-0 overflow-y-auto p-5 max-lg:max-h-[45dvh] lg:w-80">
        <Link href="/dashboard" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Dashboard
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Liquid playground</h1>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">Pour, tilt, shake and stir a tank of simulated liquid.</p>
        <Controls
          settings={settings}
          onChange={setSettings}
          count={count}
          paused={paused}
          onPausedChange={setPaused}
          onPouringChange={setPouring}
          onShake={() => scene.current!.shake()}
          onReset={() => scene.current!.reset()}
        />
      </Card>
    </main>
  );
}
