class SymbolSearch {
  constructor(matcher) {
    this.matcher = matcher;
    this.worker = null;
    this.url = null;
  }
  get running() {
    return this.worker !== null;
  }
  cancel() {
    this.worker?.terminate();
    if (this.url) URL.revokeObjectURL(this.url);
    this.worker = null;
    this.url = null;
  }
  start(input, callbacks) {
    this.cancel();
    // Blob workers preserve local-file use without requiring a server or bundler.
    const script = `${this.matcher.toString()}; onmessage = ({data}) => {
      try {
        const result = matchSymbols(data, progress => postMessage({progress}));
        postMessage({result});
      } catch (error) { postMessage({error: error.message}); }
    };`;
    try {
      this.url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
      const worker = new Worker(this.url);
      this.worker = worker;
      worker.onmessage = ({ data }) => {
        if (this.worker !== worker) return;
        if ('progress' in data) {
          callbacks.progress(data.progress);
          return;
        }
        this.cancel();
        if (data.error) callbacks.error(data.error);
        else callbacks.complete(data.result);
      };
      worker.onerror = (event) => {
        if (this.worker !== worker) return;
        this.cancel();
        callbacks.error(event.message || 'Worker failed.');
      };
      worker.postMessage(input, [input.pixels.buffer]);
    } catch (error) {
      this.cancel();
      callbacks.error(error.message);
    }
  }
}
if (typeof module !== 'undefined') module.exports = { SymbolSearch };
