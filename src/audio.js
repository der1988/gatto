export class AmbientAudio {
  constructor() { this.enabled = false; this.context = null; this.distance = 0; this.wasGrounded = true; }

  async toggle() {
    if (!this.context) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return false;
      this.context = new Audio();
      const buffer = this.context.createBuffer(1, this.context.sampleRate * 8, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        last = (last + Math.random() * .02 - .01) / 1.012;
        data[i] = last * 3.5;
      }
      const noise = this.context.createBufferSource(); noise.buffer = buffer; noise.loop = true;
      const filter = this.context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 470;
      this.master = this.context.createGain(); this.master.gain.value = 0;
      noise.connect(filter); filter.connect(this.master); this.master.connect(this.context.destination); noise.start();
    }
    await this.context.resume();
    this.enabled = !this.enabled;
    this.master.gain.setTargetAtTime(this.enabled ? .12 : 0, this.context.currentTime, .3);
    return this.enabled;
  }

  thud(strength) {
    if (!this.enabled || this.context.state !== 'running') return;
    const t = this.context.currentTime;
    const osc = this.context.createOscillator(); const gain = this.context.createGain();
    osc.frequency.setValueAtTime(90, t); osc.frequency.exponentialRampToValueAtTime(35, t + .1);
    gain.gain.setValueAtTime(.018 * strength, t); gain.gain.exponentialRampToValueAtTime(.0001, t + .12);
    osc.connect(gain); gain.connect(this.context.destination); osc.start(t); osc.stop(t + .13);
  }

  update(dt, cat, paused) {
    if (!this.enabled) return;
    if (paused) { this.distance = 0; return; }
    if (cat.grounded) {
      this.distance += Math.abs(cat.vx) * dt;
      if (this.distance > 38) { this.thud(.3 + Math.min(1, Math.abs(cat.vx) / 300) * .45); this.distance = 0; }
      if (!this.wasGrounded) this.thud(1.5);
    }
    this.wasGrounded = cat.grounded;
  }
}
