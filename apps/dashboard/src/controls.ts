import type { DashboardView } from '../../server/src/model.js';
import { Api, element, toast } from './api.js';

interface RewardProposal {
  decision: {
    decisionId: string;
    source?: 'local' | 'decionis';
    approval?: { url: string; expiresAt: number };
  };
  expiresAt: number;
}

type RewardResult =
  { configured: true; rewardId: string } | (RewardProposal & { configured: false; pending: true });

export class StreamControls {
  private proposal?: RewardProposal;
  private busy = false;
  private revision = 0;
  constructor(
    private readonly hostId: string,
    private readonly api: Api,
    private readonly refresh: () => Promise<void>,
  ) {
    const setup = document.createElement('div');
    setup.className = 'streamTools';
    setup.innerHTML = `<a class="button subtle" id="warlordPractice" href="/warlord/demo" target="_blank" rel="noreferrer">Open Warlord practice ↗</a><div id="liveTools" hidden><button class="button subtle" id="startCollab" disabled>Start Shared Chat rumble ↗</button><select id="collabPeer" aria-label="Visiting Shared Chat channel"></select><button class="button subtle" id="configureReward">Set up Reinforcements ↗</button><p class="muted">Affiliate and Partner channels can add a 100-point reward.</p></div><section class="rewardApproval" id="rewardApproval" hidden><h3>Create Reinforcements?</h3><p>This adds a 100 Channel Point reward to your channel. One use per viewer per match gives +1 input weight for 10 seconds.</p><p id="rewardState" aria-live="polite"></p><a class="button subtle" id="rewardLink" target="_blank" rel="noopener noreferrer" hidden>Open approval ↗</a><button class="button primary" id="approveReward">Create this reward ↗</button><button class="textButton" id="cancelReward">Cancel</button></section>`;
    element('setup').append(setup);
    element('liveTools').hidden = hostId === 'demo';
    element('warlordPractice').hidden = hostId !== 'demo';
    this.showProposal();
    if (hostId !== 'demo') void this.restoreProposal();
    element('configureReward').addEventListener('click', () => {
      void this.run(async () => {
        this.showProposal(
          await api.post<RewardProposal>(`/api/rewards/${encodeURIComponent(hostId)}`),
        );
      });
    });
    element('approveReward').addEventListener('click', () => {
      void this.run(async () => {
        if (!this.proposal) return;
        try {
          const result = await api.post<RewardResult>(
            `/api/rewards/${encodeURIComponent(hostId)}/approve`,
            { decisionId: this.proposal.decision.decisionId },
          );
          if (result.configured === true) {
            this.showProposal();
            toast('Reinforcements is ready on your channel.');
          } else if (result.pending === true) {
            this.showProposal(result);
          } else {
            throw new Error('Reward configuration was not confirmed.');
          }
        } catch (error) {
          await this.restoreProposal();
          throw error;
        }
      });
    });
    element('cancelReward').addEventListener('click', () => {
      this.revision += 1;
      this.showProposal();
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
    if (this.proposal) this.showProposal(this.proposal);
  }

  private showProposal(proposal?: RewardProposal): void {
    this.proposal = proposal && proposal.expiresAt > Date.now() ? proposal : undefined;
    element('rewardApproval').hidden = !this.proposal;
    const link = element<HTMLAnchorElement>('rewardLink');
    link.hidden = true;
    link.removeAttribute('href');
    const approval = this.proposal?.decision.approval;
    if (approval && approval.expiresAt > Date.now()) {
      try {
        const url = new URL(approval.url);
        if (url.protocol === 'https:' && !url.username && !url.password) {
          link.href = approval.url;
          link.hidden = false;
        }
      } catch {
        /* A missing or invalid approval link never authorizes a reward. */
      }
    }
    const hosted = this.proposal?.decision.source === 'decionis';
    element('approveReward').textContent = hosted ? 'Check approval' : 'Create this reward ↗';
    const seconds = Math.max(0, Math.ceil(((this.proposal?.expiresAt ?? 0) - Date.now()) / 1000));
    element('rewardState').textContent = this.proposal
      ? `${hosted ? 'Waiting for host verification.' : 'Confirm this channel change.'} ${seconds}s left.`
      : '';
  }

  private async restoreProposal(): Promise<void> {
    const revision = this.revision;
    try {
      const status = await this.api.get<{ pending?: RewardProposal }>(
        `/api/rewards/${encodeURIComponent(this.hostId)}`,
      );
      if (revision === this.revision) this.showProposal(status.pending);
    } catch {
      /* Keep the existing proposal until its deadline when status is unavailable. */
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.revision += 1;
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
