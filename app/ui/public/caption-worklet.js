// Original local microphone processor. It emits bounded PCM blocks and never produces audible output.
class CaptionPcmProcessor extends AudioWorkletProcessor {
  constructor(){super();this.samples=new Float32Array(1024);this.used=0;}
  process(inputs){const input=inputs[0]?.[0];if(input)for(const sample of input){this.samples[this.used++]=sample;if(this.used===this.samples.length){this.port.postMessage(this.samples);this.samples=new Float32Array(1024);this.used=0;}}return true;}
}
registerProcessor('chausar-caption-pcm',CaptionPcmProcessor);
