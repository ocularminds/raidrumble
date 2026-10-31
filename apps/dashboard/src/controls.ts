import type { DashboardView } from '../../server/src/model.js';
import { Api, element, toast } from './api.js';

interface RewardProposal {
  decision: { decisionId: string };
  expiresAt: number;
}

export class StreamControls {
  private proposal?: RewardProposal;
  private busy = false;
  constructor(
    private readonly hostId: string,
    api: Api,
    private readonly refresh: () => Promise<void>,
  ) {
    const setup = document.createElement('div');
    setup.className = 'streamTools';
    setup.innerHTML = `<a class="button subtle" id="warlordPractice" href="/warlord/demo" target="_blank" rel="noreferrer">Open Warlord practice ↗</a><div id="liveTools" hidden><button class="button subtle" id="startCollab" disabled>Start Shared Chat rumble ↗</button><select id="collabPeer" aria-label="Visiting Shared Chat channel"></select><button class="button subtle" id="configureReward">Set up Reinforcements ↗</button><p class="muted">Affiliate and Partner channels can add a 100-point reward.</p></div><section class="rewardApproval" id="rewardApproval" hidden><h3>Create Reinforcements?</h3><p>This adds a 100 Channel Point reward to your channel. One use per viewer per match gives +1 input weight for 10 seconds.</p><button class="button primary" id="approveReward">Create this reward ↗</button><button class="textButton" id="cancelReward">Cancel</button></section>`;
    element('setup').append(setup);
    element('liveTools').hidden = hostId === 'demo';
    element('warlordPractice').hidden = hostId !== 'demo';
    element('configureReward').addEventListener('click', () => {
      void this.run(async () => {
        this.proposal = await api.post<RewardProposal>(
          `/api/rewards/${encodeURIComponent(hostId)}`,
        );
        element('rewardApproval').hidden = false;
      });
    });
    element('approveReward').addEventListener('click', () => {
      void this.run(async () => {
        if (!this.proposal) return;
        await api.post(`/api/rewards/${encodeURIComponent(hostId)}/approve`, {
          decisionId: this.proposal.decision.decisionId,
        });
        this.proposal = undefined;
        element('rewardApproval').hidden = true;
        toast('Reinforcements is ready on your channel.');
      });
    });
    element('cancelReward').addEventListener('click', () => {
      this.proposal = undefined;
      element('rewardApproval').hidden = true;
    });
    element('startCollab').addEventListener('click', () => {
      void this.run(async () => {
        await api.post(`/api/collab/${encodeURIComponent(hostId)}`, {
          peerId: element<HTMLSelectElement>('collabPeer').value,
        });
      });
    });
  }

  update(data: DashboardView): void {
    const peers = (data.shared ?? []).filter((id) => id !== this.hostId);
    const select = element<HTMLSelectElement>('collabPeer');
    if ([...select.options].map((option) => option.value).join() !== peers.join()) {
      select.replaceChildren(
        ...peers.map((peer) => {
          const option = document.createElement('option');
          option.value = peer;
          option.textContent = `Channel ${peer}`;
          return option;
        }),
      );
    }
    select.hidden = peers.length < 2;
    element<HTMLButtonElement>('startCollab').disabled =
      !peers.length ||
      data.arena.status === 'active' ||
      data.arena.status === 'pending' ||
      this.busy;
    if (this.proposal && Date.now() >= this.proposal.expiresAt) {
      this.proposal = undefined;
      element('rewardApproval').hidden = true;
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await action();
      await this.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The action could not be completed.');
    } finally {
      this.busy = false;
    }
  }
}
