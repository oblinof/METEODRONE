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
  ["C", "D", "E", "F", "G", "A", "B"], // Major
  ["C", "D", "E", "F#", "G", "A", "B"], // Lydian
  ["C", "D", "E", "F", "G", "A", "Bb"], // Mixolydian
  ["C", "D", "E", "G", "A"], // Major Pentatonic
  ["C", "D", "E", "F#", "G", "A", "Bb"], // Lydian Dominant
  ["C", "D", "E", "F#", "G", "A", "Bb"], // Acoustic (Lydian Dominant)
  ["C", "D", "Eb", "E", "G", "A"], // Major Blues
  ["C", "Db", "E", "F#", "G#", "A#", "B"], // Enigmatic (weird but bright)
  ["C", "D", "E", "F", "G", "Ab", "B"], // Harmonic Major
  ["C", "D", "E", "F#", "A", "Bb"] // Prometheus
];

const NIGHT_SCALES = [
  ["C", "D", "Eb", "F", "G", "Ab", "Bb"], // Natural Minor (Aeolian)
  ["C", "D", "Eb", "F", "G", "A", "Bb"], // Dorian
  ["C", "Db", "Eb", "F", "G", "Ab", "Bb"], // Phrygian
  ["C", "Db", "Eb", "F", "Gb", "Ab", "Bb"], // Locrian
  ["C", "Eb", "F", "G", "Bb"], // Minor Pentatonic
  ["C", "D", "Eb", "F", "G", "Ab", "B"], // Harmonic Minor
  ["C", "D", "Eb", "F", "G", "A", "B"], // Melodic Minor
  ["C", "D", "Eb", "F#", "G", "Ab", "B"], // Hungarian Minor
  ["C", "Db", "E", "F", "G", "Ab", "Bb"], // Phrygian Dominant
  ["C", "D", "Eb", "G", "Ab"] // Hirajoshi
];

const OSC_TYPES = ["sine", "triangle", "square", "sawtooth", "sine4", "triangle4"];

export class MeteoDrone {
  private synth: Tone.PolySynth<Tone.FMSynth>;
  private filter: Tone.Filter;
  private reverb: Tone.Reverb;
  private delay: Tone.PingPongDelay;
  private delayPanLfo: Tone.LFO;
  private delayTimeLfo: Tone.LFO;
  private chorus: Tone.Chorus;
  private stereoWidener: Tone.StereoWidener;
  private filterLfo: Tone.LFO;
  private arpSequence: Tone.Loop | null = null;
  private droneLoop: Tone.Loop | null = null;
  private currentDrone: string[] = [];
  
  public isPlaying = false;
  
  constructor() {
    this.synth = new Tone.PolySynth(Tone.FMSynth, {
      maxPolyphony: 8,
      options: {
        harmonicity: 1.5,
        modulationIndex: 10,
        oscillator: { type: "sine" },
        modulation: { type: "triangle" },
        envelope: { attack: 4, decay: 3, sustain: 0.9, release: 6 },
        modulationEnvelope: { attack: 4, decay: 3, sustain: 0.9, release: 6 }
      }
    });
    
    this.filter = new Tone.Filter(2000, "lowpass", -24);
    this.chorus = new Tone.Chorus(4, 3, 0.6).start();
    this.delay = new Tone.PingPongDelay("8n", 0.3);
    
    // Add subtle panning variations and time modulation to delay for generative feel
    this.delayPanLfo = new Tone.LFO(0.1, -0.5, 0.5).start();
    // In PingPongDelay, pan acts as a pre-pan to the delay lines
    // ToneJS PingPong doesn't expose pan directly, so we modulate delay times slightly instead
    this.delayTimeLfo = new Tone.LFO(0.05, 0.98, 1.02).start();
    // Multiply the base delay time by this LFO (faux tape modulation)
    const delayTimeMult = new Tone.Multiply();
    this.delayTimeLfo.connect(delayTimeMult.factor);
    
    // Tone.Reverb's generation is async, so we'll init it.
    this.reverb = new Tone.Reverb({ decay: 6, preDelay: 0.1 });
    
    this.stereoWidener = new Tone.StereoWidener(0.9);
    
    // Slow evolving filter
    this.filterLfo = new Tone.LFO({ frequency: 0.1, min: 200, max: 1500, type: "sine" }).start();
    this.filterLfo.connect(this.filter.frequency);
    
    // Routing -> synth -> filter -> chorus -> delay -> reverb -> widener -> Master
    this.synth.chain(
      this.filter, 
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
      this.synth.triggerRelease(this.currentDrone, Tone.now());
      this.currentDrone = [];
    }
    
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
    return Math.abs(Math.floor(data.temperature * 13 + data.humidity * 7 + data.pressure + data.windDirection));
  }

  async updateParametersAndPlay(data: WeatherData) {
    // Stop any existing sounds gracefully
    await this.stop();
    await this.start();
    
    const hash = this.hashData(data);
    
    // 1. Temperature -> Base Octave & Note Range
    const baseOctave = Math.floor(Math.round(this.mapRange(data.temperature, -10, 40, 2, 5)));
    
    // 9. isDay -> Scale Type (Pick from 10 day scales or 10 night scales)
    const scaleIndex = hash % 10;
    const baseScale = data.isDay === 1 ? DAY_SCALES[scaleIndex] : NIGHT_SCALES[scaleIndex];
    
    // Depending on pentatonic (5 notes) or heptatonic (7 notes)
    const activeNotes = [];
    activeNotes.push(`${baseScale[0]}${baseOctave}`);
    if (baseScale.length >= 3) activeNotes.push(`${baseScale[2]}${baseOctave}`);
    if (baseScale.length >= 5) activeNotes.push(`${baseScale[4]}${baseOctave}`);
    else activeNotes.push(`${baseScale[1]}${baseOctave+1}`); // fallback
    
    activeNotes.push(`${baseScale[1]}${baseOctave + 1}`);
    if (baseScale.length >= 6) activeNotes.push(`${baseScale[5]}${baseOctave + 1}`);
    activeNotes.push(`${baseScale[0]}${baseOctave + 2}`);

    // Timbral Variety based on weather condition (hash & wind speed)
    const oscType = OSC_TYPES[hash % OSC_TYPES.length] as Tone.ToneOscillatorType;
    const modType = OSC_TYPES[(hash + 3) % OSC_TYPES.length] as Tone.ToneOscillatorType;
    
    // Slower attack for calmer weather, faster for stormy
    const envAttack = this.mapRange(data.windSpeed, 0, 100, 5, 0.5);
    const envRelease = this.mapRange(data.windSpeed, 0, 100, 8, 2);
    
    this.synth.set({
       oscillator: { type: oscType },
       modulation: { type: modType },
       envelope: { attack: envAttack, release: envRelease, decay: 4, sustain: 0.8 },
       modulationEnvelope: { attack: envAttack * 1.5, release: envRelease, decay: 4, sustain: 0.8 }
    });

    // 2. Humidity -> Reverb
    const reverbDecay = this.mapRange(data.humidity, 0, 100, 3, 15);
    this.reverb.decay = reverbDecay;
    this.reverb.wet.value = this.mapRange(data.humidity, 0, 100, 0.3, 0.9);

    // 3. Wind Speed -> Arp Speed & movement
    const arpSpeeds = ["1n", "2n", "4n", "4n.", "8n", "8t", "16n"];
    const speedIndex = Math.floor(this.mapRange(data.windSpeed, 0, 80, 0, 6));
    const arpRate = arpSpeeds[speedIndex];
    this.filterLfo.frequency.rampTo(this.mapRange(data.windSpeed, 0, 80, 0.02, 3), 1);
    
    // Vary delay time based on wind as well for subtle changes
    this.delayTimeLfo.frequency.value = this.mapRange(data.windSpeed, 0, 80, 0.01, 0.5);

    // 4. Apparent Temperature -> FM Mod Amount
    const modIndex = this.mapRange(data.apparentTemperature, -10, 40, 0.5, 25);
    this.synth.set({ modulationIndex: modIndex });

    // 5. Atmospheric Pressure -> Base Cutoff
    const filterMaxLimit = this.mapRange(data.pressure, 950, 1050, 600, 6000);
    this.filterLfo.max = filterMaxLimit;
    this.filterLfo.min = filterMaxLimit * 0.1;

    // 6. Wind Direction -> Detune & Pan
    const detuneCents = this.mapRange(data.windDirection, 0, 360, -40, 40);
    this.synth.set({ detune: detuneCents });
    this.stereoWidener.width.value = this.mapRange(Math.abs(180 - data.windDirection), 0, 180, 0.3, 1);

    // 7. Weather Code -> FM Ratios
    let harmonicity = 1.5;
    if (data.weatherCode === 0) harmonicity = 1.0; // Pure
    else if (data.weatherCode < 4) harmonicity = 1.5; // Perfect 5th
    else if (data.weatherCode < 50) harmonicity = 2.01; // Slightly detuned octave
    else if (data.weatherCode < 70) harmonicity = 2.5; // rain (gritty)
    else if (data.weatherCode < 80) harmonicity = 3.14; // snow -> bell (inharmonic)
    else harmonicity = Math.random() * 5; // chaos
    this.synth.set({ harmonicity: harmonicity });

    // 8. Cloud Cover -> Delay
    this.delay.feedback.rampTo(this.mapRange(data.cloudCover, 0, 100, 0.2, 0.85), 0.5);
    this.delay.wet.rampTo(this.mapRange(data.cloudCover, 0, 100, 0.1, 0.7), 0.5);

    // 10. Dewpoint -> Resonance / Filter Q
    this.filter.Q.value = this.mapRange(data.dewPoint, -10, 30, 0.1, 8);
    
    // Play sound!
    const droneVolume = -15; // dB
    this.synth.volume.value = droneVolume;
    
    // Background pad chord
    this.currentDrone = activeNotes.slice(0, 3);
    const now = Tone.now();
    this.synth.triggerAttack(this.currentDrone, now, 0.3);
    
    // Evolving drone loop
    this.droneLoop = new Tone.Loop((time) => {
      // Pick random notes from the base 2 octaves
      const lowerNotes = [];
      for (let oct = baseOctave; oct <= baseOctave + 1; oct++) {
        baseScale.forEach(n => lowerNotes.push(`${n}${oct}`));
      }
      
      const shuffled = lowerNotes.sort(() => 0.5 - Math.random());
      const newDrone = shuffled.slice(0, 3);
      
      // Slight glide / crossfade effect
      this.synth.triggerRelease(this.currentDrone, time);
      this.currentDrone = newDrone;
      this.synth.triggerAttack(this.currentDrone, time + 0.5, 0.2 + Math.random() * 0.1);
    }, "2m"); // Change drone every 2 measures
    
    this.droneLoop.start(0);
    
    // Generative Arpeggiation Note Pool
    const allScaleNotes: string[] = [];
    for (let oct = baseOctave + 1; oct <= baseOctave + 3; oct++) {
      baseScale.forEach(n => allScaleNotes.push(`${n}${oct}`));
    }
    
    let currentNoteIndex = Math.floor(allScaleNotes.length / 2);
    
    this.arpSequence = new Tone.Loop((time) => {
      // Random walk index
      const step = Math.floor(Math.random() * 5) - 2; // -2 to +2
      currentNoteIndex += step;
      
      // Bounce off boundaries
      if (currentNoteIndex < 0) currentNoteIndex = 1;
      if (currentNoteIndex >= allScaleNotes.length) currentNoteIndex = allScaleNotes.length - 2;
      
      const note = allScaleNotes[currentNoteIndex];
      const vel = 0.05 + Math.random() * 0.15;
      
      // Sparsity and dynamics
      if (Math.random() > 0.2) {
        const dur = Math.random() > 0.8 ? "2n" : "4n";
        // Humanize timing
        const tOffset = (Math.random() - 0.5) * 0.05;
        this.synth.triggerAttackRelease(note, dur, time + tOffset, vel);
      }
    }, arpRate);
    
    this.arpSequence.start(0);
    this.isPlaying = true;
  }
}

