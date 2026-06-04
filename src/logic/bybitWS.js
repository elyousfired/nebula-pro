class BybitWSManager {
  constructor() {
    this.ws = null;
    this.subscribers = new Map(); // symbol -> array of callbacks
    this.reconnectTimeout = null;
    this.connect();
  }

  connect() {
    this.ws = new WebSocket('wss://stream.bybit.com/v5/public/spot');
    
    this.ws.onopen = () => {
      console.log('Bybit WS Connected');
      // Resubscribe to all existing symbols
      const symbols = Array.from(this.subscribers.keys());
      if (symbols.length > 0) {
        this._subscribeToSymbols(symbols);
      }
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.topic && msg.topic.startsWith('kline.D.')) {
        const symbol = msg.topic.split('.')[2];
        const data = msg.data?.[0];
        if (data && this.subscribers.has(symbol)) {
          const callbacks = this.subscribers.get(symbol);
          callbacks.forEach(cb => cb(data));
        }
      }
    };

    this.ws.onclose = () => {
      console.log('Bybit WS Disconnected, reconnecting...');
      this.reconnectTimeout = setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket Error', error);
      this.ws.close();
    };
  }

  _subscribeToSymbols(symbols) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Bybit allows max 10 args per subscribe message, but for simplicity we can send them all if small,
      // or chunk them. Let's chunk them by 10.
      for (let i = 0; i < symbols.length; i += 10) {
        const chunk = symbols.slice(i, i + 10).map(s => `kline.D.${s}`);
        this.ws.send(JSON.stringify({ op: 'subscribe', args: chunk }));
      }
    }
  }

  _unsubscribeFromSymbols(symbols) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      for (let i = 0; i < symbols.length; i += 10) {
        const chunk = symbols.slice(i, i + 10).map(s => `kline.D.${s}`);
        this.ws.send(JSON.stringify({ op: 'unsubscribe', args: chunk }));
      }
    }
  }

  subscribe(symbol, callback) {
    if (!this.subscribers.has(symbol)) {
      this.subscribers.set(symbol, []);
      this._subscribeToSymbols([symbol]);
    }
    this.subscribers.get(symbol).push(callback);
  }

  unsubscribe(symbol, callback) {
    if (this.subscribers.has(symbol)) {
      let callbacks = this.subscribers.get(symbol);
      callbacks = callbacks.filter(cb => cb !== callback);
      
      if (callbacks.length === 0) {
        this.subscribers.delete(symbol);
        this._unsubscribeFromSymbols([symbol]);
      } else {
        this.subscribers.set(symbol, callbacks);
      }
    }
  }
}

export const bybitWS = new BybitWSManager();
