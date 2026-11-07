import React from "@rbxts/react";
import { createRoot } from "@rbxts/react-roblox";
import { ClientEvents } from "client/networking";
import { NETWORK_PROTOCOL_VERSION } from "shared/networking";
import { COUNTER_COOLDOWN_SECONDS, COUNTER_LIMIT } from "shared/reference-counter-config";

/** Mount before readiness is sent, so the initial snapshot cannot race subscription. */
export function startReferenceCounter() {
	const player = game.GetService("Players").LocalPlayer;
	const gui = new Instance("ScreenGui");
	gui.Name = "ReferenceCounter";
	gui.ResetOnSpawn = false;
	gui.Parent = player.WaitForChild("PlayerGui");
	const root = createRoot(gui);
	let count: number | undefined;
	let pending = false;
	let retry = false;
	let nextAllowed = 0;
	let timeout: thread | undefined;
	let destroyed = false;
	function render() {
		if (destroyed) return;
		const disabled = count === undefined || pending || count >= COUNTER_LIMIT;
		const status =
			count === undefined
				? "Connecting…"
				: count >= COUNTER_LIMIT
					? "Session limit reached"
					: pending
						? "Waiting for server…"
						: retry
							? "No reply yet. Try again."
							: "Ready to add one";
		root.render(
			<frame
				key="Card"
				AnchorPoint={new Vector2(0.5, 0)}
				Position={new UDim2(0.5, 0, 0, 16)}
				Size={new UDim2(1, -32, 0, 224)}
				BackgroundColor3={Color3.fromRGB(16, 24, 39)}
				BorderSizePixel={0}
			>
				<uisizeconstraint MaxSize={new Vector2(360, 224)} />
				<uicorner CornerRadius={new UDim(0, 12)} />
				<uipadding
					PaddingTop={new UDim(0, 16)}
					PaddingBottom={new UDim(0, 16)}
					PaddingLeft={new UDim(0, 16)}
					PaddingRight={new UDim(0, 16)}
				/>
				<textlabel
					key="Title"
					BackgroundTransparency={1}
					Size={new UDim2(1, 0, 0, 24)}
					Text="Session counter"
					Font={Enum.Font.GothamBold}
					TextSize={16}
					TextColor3={Color3.fromRGB(241, 245, 249)}
				/>
				<textlabel
					key="Count"
					BackgroundTransparency={1}
					Position={UDim2.fromOffset(0, 24)}
					Size={new UDim2(1, 0, 0, 64)}
					Text={count === undefined ? "—" : tostring(count)}
					Font={Enum.Font.GothamBold}
					TextSize={40}
					TextColor3={Color3.fromRGB(241, 245, 249)}
				/>
				<textlabel
					key="Status"
					BackgroundTransparency={1}
					Position={UDim2.fromOffset(0, 88)}
					Size={new UDim2(1, 0, 0, 24)}
					Text={status}
					Font={Enum.Font.Gotham}
					TextSize={14}
					TextColor3={Color3.fromRGB(180, 192, 211)}
				/>
				<textbutton
					key="Increment"
					Position={UDim2.fromOffset(0, 128)}
					Size={new UDim2(1, 0, 0, 48)}
					BorderSizePixel={0}
					BackgroundColor3={disabled ? Color3.fromRGB(51, 65, 85) : Color3.fromRGB(141, 224, 189)}
					TextColor3={disabled ? Color3.fromRGB(180, 192, 211) : Color3.fromRGB(16, 24, 39)}
					Text="Add one"
					TextSize={16}
					Font={Enum.Font.GothamBold}
					Active={!disabled}
					Selectable={!disabled}
					AutoButtonColor={!disabled}
					Event={{ Activated: increment }}
				>
					<uicorner CornerRadius={new UDim(0, 8)} />
				</textbutton>
			</frame>,
		);
	}
	function increment() {
		if (count === undefined || pending || count >= COUNTER_LIMIT || os.clock() < nextAllowed) return;
		pending = true;
		retry = false;
		nextAllowed = os.clock() + COUNTER_COOLDOWN_SECONDS;
		ClientEvents.incrementCounter.fire(NETWORK_PROTOCOL_VERSION, count);
		timeout = task.delay(2, () => {
			timeout = undefined;
			pending = false;
			retry = true;
			render();
		});
		render();
	}
	const snapshot = ClientEvents.counterSnapshot.connect((protocol, value) => {
		if (
			protocol !== NETWORK_PROTOCOL_VERSION ||
			value < 0 ||
			value > COUNTER_LIMIT ||
			value % 1 !== 0 ||
			(count !== undefined && value < count)
		)
			return;
		count = value;
		pending = false;
		retry = false;
		if (timeout !== undefined) {
			task.cancel(timeout);
			timeout = undefined;
		}
		render();
	});
	function cleanup() {
		if (destroyed) return;
		destroyed = true;
		snapshot.Disconnect();
		cleanupConnection.Disconnect();
		if (timeout !== undefined) task.cancel(timeout);
		root.unmount();
		gui.Destroy();
	}
	const cleanupConnection = script.Destroying.Connect(cleanup);
	gui.Destroying.Connect(() => {
		if (!destroyed) cleanup();
	});
	render();
	return cleanup;
}
