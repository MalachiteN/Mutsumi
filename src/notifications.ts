import { NotificationCenter, WindowsToaster } from "node-notifier";

type MacNotifier = InstanceType<typeof NotificationCenter>;
type WinNotifier = InstanceType<typeof WindowsToaster>;

let macNotifier: MacNotifier | undefined;
let winNotifier: WinNotifier | undefined;

function getNotifier(): MacNotifier | WinNotifier | undefined {
	if (process.platform === "darwin") {
		if (!macNotifier) {
			macNotifier = new NotificationCenter({ withFallback: true });
		}
		return macNotifier;
	}
	if (process.platform === "win32") {
		if (!winNotifier) {
			winNotifier = new WindowsToaster({ withFallback: true });
		}
		return winNotifier;
	}
	return undefined;
}

/**
 * Fire a native OS notification. Informational only — no inline action
 * buttons; approval must be acted on in the sidebar.
 */
export function notifyWaitingForApproval(
	title: string,
	message: string,
	subtitle?: string,
): void {
	const notifier = getNotifier();
	if (!notifier) {
		return;
	}

	try {
		notifier.notify(
			{
				title,
				message,
				subtitle,
				sound: true,
				timeout: 8,
			},
			(err: Error | null | undefined) => {
				if (err) {
					console.warn("[mutsumi] native notification failed:", err.message);
				}
			},
		);
	} catch (e) {
		console.warn("[mutsumi] native notification threw:", e);
	}
}

export function notifyApprovalNeeded(actionDescription: string): void {
	notifyWaitingForApproval(
		"Mutsumi",
		`${actionDescription} — review in the sidebar`,
		"Approval needed",
	);
}
