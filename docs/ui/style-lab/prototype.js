// Browser-only interaction specimen. No network, asset IDs or runtime dependencies.
const items = [
	{
		name: "Mossguard",
		tone: "moss",
		rarity: "Uncommon",
		material: "Oak & painted iron",
		character: "Grounded, enduring",
		description: "Weathered oak, wrapped in forest green. A dependable companion for unfamiliar paths.",
	},
	{
		name: "Sunward",
		tone: "amber",
		rarity: "Rare",
		material: "Brass & warm leather",
		character: "Bright, resolute",
		description: "Hammered brass catches the last light. Made for those who take the longer way home.",
	},
	{
		name: "Stonewake",
		tone: "slate",
		rarity: "Common",
		material: "Slate & forged steel",
		character: "Quiet, steadfast",
		description: "Cool stone held in a simple steel frame. Nothing extra. Everything you need.",
	},
];
const find = (selector) => document.querySelector(selector);
let selected = 0;
let equipped = 0;
let pending = false;
let audioContext;
let pendingTimer;
let effectTimer;

function cue(success) {
	if (!find("#sound-toggle").checked) return;
	// One short voice. Production audio requires authored sources and native mix review.
	audioContext ??= new AudioContext();
	void audioContext.resume();
	const oscillator = audioContext.createOscillator();
	const gain = audioContext.createGain();
	oscillator.type = "sine";
	oscillator.frequency.setValueAtTime(success ? 660 : 220, audioContext.currentTime);
	oscillator.frequency.exponentialRampToValueAtTime(success ? 880 : 180, audioContext.currentTime + 0.08);
	gain.gain.setValueAtTime(0, audioContext.currentTime);
	gain.gain.linearRampToValueAtTime(0.04, audioContext.currentTime + 0.008);
	gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.12);
	oscillator.connect(gain).connect(audioContext.destination);
	oscillator.start();
	oscillator.stop(audioContext.currentTime + 0.14);
	oscillator.onended = () => {
		oscillator.disconnect();
		gain.disconnect();
	};
}

function status(message, error = false) {
	find("#status").textContent = message;
	find("#status").classList.toggle("error", error);
}

function render() {
	const empty = find("#empty-toggle").checked;
	const item = items[selected];
	find(".items").hidden = empty;
	find(".empty").hidden = !empty;
	find("#count").textContent = empty ? "00 objects" : "03 objects";
	find("#detail-name").textContent = empty ? "Your next discovery" : item.name;
	find("#detail-rarity").textContent = empty ? "A new chapter" : `${item.rarity} / 0${selected + 1}`;
	find("#description").textContent = empty
		? "There is more out there. Come back when you have something to carry."
		: item.description;
	find("#material").textContent = empty ? "—" : item.material;
	find("#character").textContent = empty ? "—" : item.character;
	find(".detail-object").hidden = empty;
	find("#hero-object").className = `object large ${item.tone}`;
	find("#equip").disabled = empty || pending || selected === equipped;
	find("#equip").textContent = empty
		? "No item selected"
		: pending
			? "Equipping…"
			: selected === equipped
				? "Equipped"
				: "Equip item";
	document.querySelectorAll(".item").forEach((button, index) => {
		button.classList.toggle("selected", index === selected);
		button.setAttribute("aria-pressed", String(index === selected));
		button.disabled = pending;
		button.querySelector(".equipped-badge").hidden = index !== equipped;
	});
}

document.querySelectorAll(".item").forEach((button, index) =>
	button.addEventListener("click", () => {
		selected = index;
		find(".detail-object").classList.remove("celebrate");
		status(selected === equipped ? "Ready for the next trail." : "Selected. Equip when you are ready.");
		render();
	}),
);

find("#equip").addEventListener("click", () => {
	if (pending || find("#empty-toggle").checked || selected === equipped) return;
	pending = true;
	const reject = find("#reject-toggle").checked;
	find("#reject-toggle").checked = false;
	status("Waiting for confirmation…");
	render();
	pendingTimer = setTimeout(() => {
		pending = false;
		if (reject) {
			status("Could not equip. Your previous item is still equipped. Try again.", true);
		} else {
			equipped = selected;
			status(`${items[selected].name} equipped. Ready for the next trail.`);
			find(".detail-object").classList.add("celebrate");
			clearTimeout(effectTimer);
			effectTimer = setTimeout(() => find(".detail-object").classList.remove("celebrate"), 450);
		}
		cue(!reject);
		render();
	}, 550);
});

function emptyChanged() {
	clearTimeout(pendingTimer);
	clearTimeout(effectTimer);
	pending = false;
	find(".detail-object").classList.remove("celebrate");
	status(
		find("#empty-toggle").checked
			? "No equipment yet. Your journey starts here."
			: "Sample collection restored.",
	);
	render();
}
find("#empty-toggle").addEventListener("change", emptyChanged);
find("#restore").addEventListener("click", () => {
	find("#empty-toggle").checked = false;
	emptyChanged();
	find(".item").focus();
});
find("#motion-toggle").checked = matchMedia("(prefers-reduced-motion: reduce)").matches;
find("#motion-toggle").addEventListener("change", (event) =>
	document.body.classList.toggle("reduce-motion", event.target.checked),
);
document.body.classList.toggle("reduce-motion", find("#motion-toggle").checked);
window.addEventListener("pagehide", () => {
	clearTimeout(pendingTimer);
	clearTimeout(effectTimer);
	void audioContext?.close();
});
render();
