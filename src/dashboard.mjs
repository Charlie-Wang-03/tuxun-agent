import {createDashboardServer} from './dashboard-server.mjs';
import {listenBrowserSafe} from './browser-port.mjs';

const server = createDashboardServer();
await listenBrowserSafe(server);
console.log(`本地控制台：http://127.0.0.1:${server.address().port}/\n请在专用 Chrome 中手动登录并开始题库经典五题。`);
