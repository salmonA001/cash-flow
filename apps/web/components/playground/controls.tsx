'use client';
import { Droplets, Pause, Play, RotateCcw, Vibrate } from 'lucide-react';
import { useId } from 'react';
import { Button } from '@/components/ui/button';

export interface PlaygroundSettings {
  gravity: number;
  viscosity: number;
  limit: number;
  tiltX: number;
  tiltZ: number;
}

interface ControlsProps {
  settings: PlaygroundSettings;
  onChange(settings: PlaygroundSettings): void;
  count: number;
  paused: boolean;
  onPausedChange(paused: boolean): void;
  onPouringChange(pouring: boolean): void;
  onShake(): void;
  onReset(): void;
}

function Slider(props: { label: string; value: number; display: string; min: number; max: number; step: number; onChange(value: number): void }) {
  const id = useId();
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <label htmlFor={id} className="font-medium">{props.label}</label>
        <span className="tabular text-xs text-muted-foreground">{props.display}</span>
      </div>
      <input
        id={id}
        type="range"
        className="w-full accent-primary"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </div>
  );
}

export function Controls({ settings, onChange, count, paused, onPausedChange, onPouringChange, onShake, onReset }: ControlsProps) {
  const set = (patch: Partial<PlaygroundSettings>) => onChange({ ...settings, ...patch });
  const full = count >= settings.limit;
  const holdKey = (pouring: boolean) => (event: React.KeyboardEvent) => {
    if (event.key === ' ' || event.key === 'Enter') onPouringChange(pouring);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        <Button
          disabled={full}
          onPointerDown={() => onPouringChange(true)}
          onPointerUp={() => onPouringChange(false)}
          onPointerLeave={() => onPouringChange(false)}
          onPointerCancel={() => onPouringChange(false)}
          onKeyDown={holdKey(true)}
          onKeyUp={holdKey(false)}
          onBlur={() => onPouringChange(false)}
        >
          <Droplets /> {full ? 'Tank full' : 'Hold to pour'}
        </Button>
        <Button variant="secondary" onClick={onShake}><Vibrate /> Shake</Button>
        <Button variant="outline" onClick={() => onPausedChange(!paused)}>
          {paused ? <><Play /> Resume</> : <><Pause /> Pause</>}
        </Button>
        <Button variant="outline" onClick={onReset}><RotateCcw /> Reset</Button>
      </div>

      <p className="tabular text-xs text-muted-foreground">{count.toLocaleString('en-US')} of {settings.limit.toLocaleString('en-US')} particles</p>

      <Slider label="Tilt left / right" display={`${settings.tiltZ}°`} min={-45} max={45} step={1} value={settings.tiltZ} onChange={(tiltZ) => set({ tiltZ })} />
      <Slider label="Tilt forward / back" display={`${settings.tiltX}°`} min={-45} max={45} step={1} value={settings.tiltX} onChange={(tiltX) => set({ tiltX })} />
      <Slider label="Gravity" display={`${settings.gravity.toFixed(1)} m/s²`} min={0} max={20} step={0.1} value={settings.gravity} onChange={(gravity) => set({ gravity })} />
      <Slider label="Viscosity" display={settings.viscosity.toFixed(2)} min={0} max={1} step={0.01} value={settings.viscosity} onChange={(viscosity) => set({ viscosity })} />
      <Slider label="Particle limit" display={settings.limit.toLocaleString('en-US')} min={1000} max={8000} step={500} value={settings.limit} onChange={(limit) => set({ limit })} />

      <p className="text-xs text-muted-foreground">Drag the tank to stir the liquid. Drag outside it to orbit, scroll to zoom. Changing the particle limit refills the tank.</p>
    </div>
  );
}
