const net = require("node:net");
function listening(port) {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection({ host: "127.0.0.1", port });
		socket.setTimeout(1000);
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", (error) => {
			socket.destroy();
			if (error.code === "ECONNREFUSED") resolve(false);
			else reject(error);
		});
		socket.once("timeout", () => {
			socket.destroy();
			reject(Error("Cannot establish Rojo listener state"));
		});
	});
}
module.exports = { listening };
