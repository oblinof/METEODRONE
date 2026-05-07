import * as Tone from 'tone';

export interface WeatherData {
  temperature: number; // -20 to 50 (C)
  humidity: number; // 0 to 100 (%)
  windSpeed: number; // 0 to 100 (km/h)
  apparentTemperature: number; // -20 to 50
  pressure: number; // ~950 to 1050 (hPa)
  windDirection: number; // 0 to 360 (deg)
  weatherCode: number; // 0 to 99
  cloudCover: number; // 0 to 100 (%)
  isDay: number; // 0 or 1
  dewPoint: number; // -20 to 50
}

const DAY_SCALES = [
  ["C", "D", "E", "G", "A"], // C Major Pentatonic
  ["G", "A", "B", "D", "E"], // G Major Pentatonic
  ["F", "G", "A", "C", "D"], // F Major Pentatonic
  ["D", "E", "F#", "A", "B"], // D Major Pentatonic
  ["A", "B", "C#", "E", "F#"], // A Major Pentatonic
  ["C", "D", "E", "F#", "G#", "Bb"], // Whole Tone (Debussy)
  ["C", "E", "F#", "G", "B"], // Lydian Pentatonic
  ["C", "D", "F", "G", "A"], // Sus4 Pentatonic
  ["E", "F#", "G#", "B", "C#"], // E Major Pentatonic
  ["Bb", "C", "D", "F", "G"] // Bb Major Pentatonic
];

const NIGHT_SCALES = [
  ["C", "Eb", "F", "G", "Bb"], // C Minor Pentatonic
  ["A", "C", "D", "E", "G"], // A Minor Pentatonic
  ["E", "G", "A", "B", "D"], // E Minor Pentatonic
  ["D", "F", "G", "A", "C"], // D Minor Pentatonic
  ["G", "Bb", "C", "D", "F"], // G Minor Pentatonic
  ["C", "D", "Eb", "G", "Ab"], // Hirajoshi (C)
  ["A", "B", "C", "E", "F"], // Hirajoshi (A)
  ["C", "Db", "F", "G", "Ab"], // Insen (C)
  ["C", "Eb", "F", "Gb", "Bb"], // Minor Blues Pentatonic
  ["B", "D", "E", "F#", "A"] // B Minor Pentatonic
];

const CARRIER_TYPES = ["sine", "triangle", "sine4", "triangle4", "sine8"];
const MOD_TYPES = ["sine", "triangle"];

export class MeteoDrone {
  private droneSynth: Tone.PolySynth<Tone.FMSynth>;
  private arpSynth: Tone.PolySynth<Tone.FMSynth>;
  private filter: Tone.Filter;
  private reverb: Tone.Reverb;
  private delay: Tone.PingPongDelay;
  private delayPanLfo: Tone.LFO;
  private chorus: Tone.Chorus;
  private stereoWidener: Tone.StereoWidener;
  private filterLfo: Tone.LFO;
  private arpSequence: Tone.Loop | null = null;
  private droneLoop: Tone.Loop | null = null;
  private currentDrone: string[] = [];
  
  public isPlaying = false;
  
  constructor() {
    const synthOptions = {
        harmonicity: 1.0, // Strict simple ratio
        modulationIndex: 1.5, // Max 4.0
        oscillator: { type: "sine" as Tone.ToneOscillatorType }, // Carrier
        modulation: { type: "sine" as Tone.ToneOscillatorType }, // Modulator restricted to sine for warmth
        envelope: { attack: 6, decay: 4, sustain: 0.9, release: 8 }, // Min attack well above 5ms
        modulationEnvelope: { attack: 6, decay: 4, sustain: 0.9, release: 8 }
    };

    this.droneSynth = new Tone.PolySynth(Tone.FMSynth, {
      maxPolyphony: 6,
      options: synthOptions
    });

    this.arpSynth = new Tone.PolySynth(Tone.FMSynth, {
      maxPolyphony: 4,
      options: {
        ...synthOptions,
        envelope: { attack: 1.5, decay: 3, sustain: 0.6, release: 4 }, // Soft attack to avoid clicks
        modulationEnvelope: { attack: 1.5, decay: 3, sustain: 0.6, release: 4 }
      }
    });
    
    // Lush 24dB lowpass dynamic filter
    this.filter = new Tone.Filter(3000, "lowpass", -24);
    
    // Fixed "Clean" Low Pass Filter at 12kHz to remove harsh digital FM artifacts
    const antiAliasingFilter = new Tone.Filter(12000, "lowpass", -24);

    // Warm short chorus for analog thickness (depth lowered drastically to avoid vibrato/siren effect)
    this.chorus = new Tone.Chorus(0.5, 2.5, 0.05).start();
    
    // High feedback ping-pong delay for Debussy-like washes
    this.delay = new Tone.PingPongDelay("4n.", 0.6);
    
    // Smooth, slow stereo panning for the delay
    this.delayPanLfo = new Tone.LFO(0.1, -0.6, 0.6).start();
    
    // Huge, lush ambient reverb
    this.reverb = new Tone.Reverb({ decay: 10, preDelay: 0.1 });
    
    this.stereoWidener = new Tone.StereoWidener(0.9);
    
    // Very slow evolving filter sweep
    this.filterLfo = new Tone.LFO({ frequency: 0.1, min: 400, max: 2500, type: "sine" }).start();
    this.filterLfo.connect(this.filter.frequency);
    
    // Routing -> synth -> anti-alias filter -> dynamic filter -> chorus -> delay -> reverb -> widener -> Master
    this.droneSynth.chain(antiAliasingFilter, this.filter);
    this.arpSynth.chain(antiAliasingFilter, this.filter);
    
    this.filter.chain(
      this.chorus, 
      this.delay, 
      this.reverb, 
      this.stereoWidener, 
      Tone.Destination
    );
  }
  
  async start() {
    await Tone.start();
    await this.reverb.ready;
    Tone.Transport.start();
  }

  async stop() {
    // Release the drones
    if (this.currentDrone.length > 0) {
      this.droneSynth.releaseAll(Tone.now());
      this.currentDrone = [];
    }
    this.arpSynth.releaseAll(Tone.now());
    
    if (this.arpSequence) {
      this.arpSequence.stop();
      this.arpSequence.dispose();
      this.arpSequence = null;
    }
    
    if (this.droneLoop) {
      this.droneLoop.stop();
      this.droneLoop.dispose();
      this.droneLoop = null;
    }
    
    this.isPlaying = false;
  }
  
  private mapRange(value: number, inMin: number, inMax: number, outMin: number, outMax: number) {
    const clampedValue = Math.min(Math.max(value, inMin), inMax);
    return outMin + (outMax - outMin) * ((clampedValue - inMin) / (inMax - inMin));
  }

  private hashData(data: WeatherData): number {
    const a = data.temperature * 137.5;
    const b = data.humidity * 83.1;
    const c = data.pressure * 13.9;
    const d = data.windDirection * 31.3;
    const e = data.weatherCode * 113.7;
    return Math.abs(Math.floor(a + b + c + d + e));
  }

  async updateParametersAndPlay(data: WeatherData) {
    // Stop any existing sounds gracefully
    await this.stop();
    await this.start();
    
    const hash = this.hashData(data);
    
    // 1. Temperature -> Base Octave & Note Range
    // Center it softly lower for pleasant pads. Octaves 2-4
    const baseOctave = Math.floor(Math.round(this.mapRange(data.temperature, -10, 40, 2, 4)));
    
    // 9. isDay -> Scale Type
    const scaleIndex = hash % (data.isDay === 1 ? DAY_SCALES.length : NIGHT_SCALES.length);
    const baseScale = data.isDay === 1 ? DAY_SCALES[scaleIndex] : NIGHT_SCALES[scaleIndex];
    
    // Smooth Drone building blocks (triad + octaves)
    const activeNotes = [];
    activeNotes.push(`${baseScale[0]}${baseOctave}`);
    if (baseScale.length >= 3) activeNotes.push(`${baseScale[2]}${baseOctave}`);
    if (baseScale.length >= 5) activeNotes.push(`${baseScale[4]}${baseOctave}`);
    else activeNotes.push(`${baseScale[1]}${baseOctave+1}`);
    activeNotes.push(`${baseScale[0]}${baseOctave + 1}`);

    // Timbral Variety: Radically change oscillator and envelope per city
    const carrierType = CARRIER_TYPES[hash % CARRIER_TYPES.length];
    const modType = MOD_TYPES[(hash + 3) % MOD_TYPES.length];
    
    // Determine "Instrument Style" based on city to ensure massive timbre variance and avoid constant "violin"
    const instrStyle = hash % 3; // 0 = Pad, 1 = EPiano/Keys, 2 = Mallet/Pluck
    
    let envAttack, envDecay, envSustain, envRelease;
    let arpEnvAttack, arpEnvDecay, arpEnvSustain, arpEnvRelease;

    if (instrStyle === 0) {
      // Warm Pad 
      envAttack = this.mapRange(data.windSpeed, 0, 100, 2.0, 0.5);
      envDecay = 4.0;
      envSustain = 0.8;
      envRelease = 5.0;
      
      arpEnvAttack = 1.0;
      arpEnvDecay = 2.0;
      arpEnvSustain = 0.5;
      arpEnvRelease = 3.0;
    } else if (instrStyle === 1) {
      // Electric Piano / Rhodes Style (No slow swell = no violin)
      envAttack = 0.05;
      envDecay = 2.0;
      envSustain = 0.4;
      envRelease = 3.0;
      
      arpEnvAttack = 0.02;
      arpEnvDecay = 1.0;
      arpEnvSustain = 0.2;
      arpEnvRelease = 2.0;
    } else {
      // Mallet / Harp Style (Plucky, completely opposite of violin)
      envAttack = 0.005;
      envDecay = 1.5;
      envSustain = 0.1;
      envRelease = 4.0;
      
      arpEnvAttack = 0.005;
      arpEnvDecay = 0.5;
      arpEnvSustain = 0.0;
      arpEnvRelease = 1.5;
    }
    
    this.droneSynth.set({
       oscillator: { type: carrierType as Tone.ToneOscillatorType },
       modulation: { type: modType as Tone.ToneOscillatorType },
       envelope: { attack: envAttack, release: envRelease, decay: envDecay, sustain: envSustain },
       modulationEnvelope: { attack: envAttack * 1.2, release: envRelease, decay: envDecay, sustain: envSustain }
    });
    this.arpSynth.set({
       oscillator: { type: carrierType as Tone.ToneOscillatorType },
       modulation: { type: modType as Tone.ToneOscillatorType },
       envelope: { attack: arpEnvAttack, decay: arpEnvDecay, sustain: arpEnvSustain, release: arpEnvRelease },
       modulationEnvelope: { attack: arpEnvAttack * 1.2, decay: arpEnvDecay, sustain: arpEnvSustain, release: arpEnvRelease }
    });

    // 2. Humidity -> Reverb
    const reverbDecay = this.mapRange(data.humidity, 0, 100, 5, 20); // Slightly shorter max decay to prevent muddy wash
    this.reverb.decay = reverbDecay;
    this.reverb.wet.value = this.mapRange(data.humidity, 0, 100, 0.4, 0.90);

    // 3. Wind Speed -> Arp Speed & movement
    // Much slower generative melody
    const arpSpeeds = ["2n", "2n.", "4n", "4n.", "8n", "8n."];
    const speedIndex = Math.floor(this.mapRange(data.windSpeed, 0, 80, 0, 5));
    const arpRate = arpSpeeds[speedIndex];
    
    // LFO is extremely slow for slow breathing pads
    this.filterLfo.frequency.rampTo(this.mapRange(data.windSpeed, 0, 80, 0.02, 1.0), 1);

    // 4. Apparent Temperature -> FM Mod Amount
    // Very gentle modulation for ambient harmonics. strictly max 3.0 to prevent any metal/bell
    const modIndex = this.mapRange(data.apparentTemperature, -10, 40, 0.1, 3.0);
    
    // 5. Atmospheric Pressure -> Base Cutoff -> More varied based on hash
    const filterBase = (hash % 1000) + 400; // 400 to 1400 Min
    const filterMaxLimit = filterBase + this.mapRange(data.pressure, 950, 1050, 800, 3000);
    this.filterLfo.max = filterMaxLimit;
    this.filterLfo.min = filterBase;

    // 6. Wind Direction -> Detune & Pan
    // Gentle detune, perfectly safe
    const detuneCents = this.mapRange(data.windDirection, 0, 360, -8, 8);
    this.droneSynth.set({ detune: detuneCents });
    this.arpSynth.set({ detune: detuneCents * 1.5 });
    
    // Wide but not dizzying
    this.stereoWidener.width.value = this.mapRange(Math.abs(180 - data.windDirection), 0, 180, 0.5, 1.0);

    // 7. Weather Code -> FM Ratios
    // STRICT PURE HARMONIC MULTIPLIERS ONLY
    const harmonicities = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0];
    let harmonicity = harmonicities[hash % harmonicities.length];
    
    if (data.weatherCode > 50) { 
       harmonicity = 2.0; // Rain/bad weather = simple octaves
    }
    
    // Velocity scaling effect via modulation index control
    this.droneSynth.set({ modulationIndex: modIndex * 0.5, harmonicity }); 
    // Arp modulates slightly more
    this.arpSynth.set({ modulationIndex: modIndex * 0.9, harmonicity });

    // 8. Cloud Cover -> Delay
    // High feedback for Debussy-like cascades
    this.delay.feedback.rampTo(this.mapRange(data.cloudCover, 0, 100, 0.4, 0.85), 0.5);
    this.delay.wet.rampTo(this.mapRange(data.cloudCover, 0, 100, 0.3, 0.7), 0.5);
    
    // Vary delay time by city hash
    const delayTimes = ["2n", "4n.", "4n", "8n.", "8n", "8t", "16n"];
    this.delay.delayTime.value = delayTimes[hash % delayTimes.length];

    // 10. Dewpoint -> Resonance / Filter Q
    // Gentle resonance
    this.filter.Q.value = this.mapRange(data.dewPoint, -10, 30, 0.2, 4);
    
    // Play sound! Volume increased from -18 to -8
    const droneVolume = instrStyle === 0 ? -12 : -8; // Pads need to be quieter than plucks/keys
    this.droneSynth.volume.value = droneVolume;
    this.arpSynth.volume.value = droneVolume;
    
    // Background pad chord: perfectly consonant Root, Fifth (+7 semitones), and Octave (+12 semitones)
    const rootNote = activeNotes[0];
    const fifthNote = Tone.Frequency(rootNote).transpose(7).toNote();
    const octaveNote = Tone.Frequency(rootNote).transpose(12).toNote();
    
    this.currentDrone = [rootNote, fifthNote, octaveNote];
    const now = Tone.now();
    this.droneSynth.triggerAttack(this.currentDrone, now, instrStyle === 0 ? 0.3 : 0.6); 
    
    // Evolving drone loop
    this.droneLoop = new Tone.Loop((time) => {
      // Modulate delay pan
      this.delayPanLfo.frequency.rampTo(0.05 + Math.random() * 0.1, 8);
      
      // Select a new root from the scale occasionally, or keep the same root and vary the inversions
      const randomScaleIndex = Math.floor(Math.random() * 3); // Pick from first 3 notes of scale to act as root
      const newRoot = activeNotes[randomScaleIndex];
      const newFifth = Tone.Frequency(newRoot).transpose(7).toNote();
      const newOctave = Tone.Frequency(newRoot).transpose(12).toNote();
      
      const newDrone = [newRoot, newFifth, newOctave];
      
      // Smooth crossfade/retrigger
      this.droneSynth.triggerRelease(this.currentDrone, time + (instrStyle === 0 ? 2 : 0.1));
      this.currentDrone = newDrone;
      this.droneSynth.triggerAttack(this.currentDrone, time, (instrStyle === 0 ? 0.2 : 0.5) + (Math.random() * 0.15));
    }, "2m"); // Modulate chords every 2 measures
    
    this.droneLoop.start(0);
    
    // Generative Soft Melody Note Pool (Debussy cascading arps)
    const allScaleNotes: string[] = [];
    for (let oct = baseOctave + 1; oct <= baseOctave + 3; oct++) {
      baseScale.forEach(n => allScaleNotes.push(`${n}${oct}`));
    }
    
    let currentNoteIndex = Math.floor(allScaleNotes.length / 2);
    
    this.arpSequence = new Tone.Loop((time) => {
      // Step up or down by 3rds or 4ths for more melodic intervals
      const step = (Math.floor(Math.random() * 5) - 2) * 2; 
      currentNoteIndex += step;
      
      if (currentNoteIndex < 0) currentNoteIndex = 1;
      if (currentNoteIndex >= allScaleNotes.length) currentNoteIndex = allScaleNotes.length - 2;
      
      const note = allScaleNotes[currentNoteIndex];
      const vel = 0.2 + Math.random() * 0.3; // Louder velocities for arps
      
      // Sparsity
      if (Math.random() > 0.3) {
        const dur = Math.random() > 0.5 ? "4n" : "8n";
        const tOffset = (Math.random() - 0.5) * 0.1;
        this.arpSynth.triggerAttackRelease(note, dur, time + tOffset, vel);
      }
    }, arpRate);
    
    this.arpSequence.start(0);
    this.isPlaying = true;
  }
}

