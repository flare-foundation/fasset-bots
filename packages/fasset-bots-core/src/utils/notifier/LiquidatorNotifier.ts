import { BaseNotifier, NotifierTransport, BotType } from "@flarenetwork/fasset-bots-common";

enum LiquidatorNotificationKey {
    AGENT_LIQUIDATED = "AGENT LIQUIDATED",
    LIQUIDATOR_IS_ONLINE = "LIQUIDATOR IS ONLINE"
}

export class LiquidatorNotifier extends BaseNotifier<LiquidatorNotificationKey> {
    constructor(address: string, transports: NotifierTransport[]) {
        super(BotType.LIQUIDATOR, address, transports);
    }

    async sendAgentLiquidated(agentVault: string) {
        await this.info(
            LiquidatorNotificationKey.AGENT_LIQUIDATED,
            `Liquidator ${this.address} liquidated agent ${agentVault}.`
        );
    }

    async sendActivityReport() {
        const now = Math.floor((new Date()).getTime() / 1000)
        await this.info(
            LiquidatorNotificationKey.LIQUIDATOR_IS_ONLINE,
            `Liquidator ${this.address} is online: ${now.toString()}.`
        );
    }
}
