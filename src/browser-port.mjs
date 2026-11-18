import {randomInt} from 'node:crypto';

// The Fetch standard currently blocks ports up to 10080. Bind loopback only.
export async function listenBrowserSafe(server, {pickPort = () => randomInt(20000, 61000), attempts = 20, platform = process.platform} = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const onError = error => { server.off('listening', onListening); reject(error); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        try { server.listen(pickPort(), '127.0.0.1'); }
        catch (error) { server.off('error', onError); server.off('listening', onListening); reject(error); }
      });
      return server.address().port;
    } catch (error) {
      // Windows may reject an otherwise unused port in a reserved range with EACCES.
      // Try another loopback port; persistent denial still fails after the bounded attempts.
      const unavailable = error.code === 'EADDRINUSE' || (platform === 'win32' && error.code === 'EACCES');
      if (!unavailable || attempt === attempts - 1) throw error;
    }
  }
  throw Error('无法找到可用的本机端口');
}
