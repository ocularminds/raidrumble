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
  private peerSignature = '';
  constructor(
    private readonly hostId: string,
    private readonly api: Api,
    private readonly refresh: () => Promise<void>,
  ) {
    const setup = document.createElement('div');
    setup.className = 'streamTools';
    setup.innerHTML = `<a class="button subtle" id="warlordPractice" href="/warlord/demo" target="_blank" rel="noreferrer">Open Warlord Practice ↗</a><div id="liveTools" hidden><button class="button subtle" id="startCollab" disabled>Start Collab Rumble</button><select id="collabPeer" aria-label="Visiting Shared Chat channel"></select><p class="muted" id="collabState">Start a Shared Chat session to play together.</p><button class="button subtle" id="configureReward">Set Up Reinforcements</button><p class="muted">Affiliate and Partner channels can add a 100-point reward.</p></div><section class="rewardApproval" id="rewardApproval" hidden><h3>Create Reinforcements?</h3><p>This adds a 100 Channel Point reward to your channel. One use per viewer per match gives +1 input weight for 10 seconds.</p><p id="rewardState" aria-live="polite"></p><a class="button subtle" id="rewardLink" target="_blank" rel="noopener noreferrer" hidden>Open Approval ↗</a><button class="button primary" id="approveReward">Create This Reward</button><button class="textButton" id="cancelReward">Cancel</button></section>`;
    element('setup').append(setup);
    const practice = document.createElement('section');
    practice.className = 'practicePanel';
    practice.hidden = hostId === 'demo';
    practice.innerHTML = `<div><span class="eyebrow">PRACTICE WITH YOUR COMMUNITY</span><h3>Test Raid · Real Chat</h3><p id="practiceState" class="muted">Play on your own overlay with real Twitch chat. Choose !join raiders or !join home, then type the word on screen.</p><small>A test match with real chat. No incoming raid or automatic players.</small></div><div class="practiceActions"><button id="practiceLive" class="button primary" disabled>Start Test Raid · Real Chat</button><button id="exitPractice" class="button subtle" hidden>Exit Test Raid</button></div>`;
    element('practiceSlot').append(practice);
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
    element('practiceLive').addEventListener('click', () => {
      void this.run(async () => {
        await api.post(`/api/test/${encodeURIComponent(hostId)}`, { realChat: true });
      });
    });
    element('exitPractice').addEventListener('click', () => {
      void this.run(async () => {
        await api.post(`/api/practice/${encodeURIComponent(hostId)}/exit`);
      });
    });
  }

  update(data: DashboardView): void {
    const peers = (data.shared ?? []).includes(this.hostId)
      ? [...new Set(data.shared)].filter((id) => id !== this.hostId)
      : [];
    const names = new Map(data.sharedChannels?.map((channel) => [channel.id, channel.name]));
    const choices = peers.map((id, index) => ({
      id,
      name: names.get(id) ?? `Shared Channel ${index + 1}`,
    }));
    const select = element<HTMLSelectElement>('collabPeer');
    const signature = JSON.stringify(choices);
    if (this.peerSignature !== signature) {
      this.peerSignature = signature;
      const selected = select.value;
      select.replaceChildren(
        ...choices.map((peer) => {
          const option = document.createElement('option');
          option.value = peer.id;
          option.textContent = peer.name;
          return option;
        }),
      );
      select.value = peers.includes(selected) ? selected : (peers[0] ?? '');
    }
    select.hidden = peers.length < 2;
    element('collabState').textContent = choices.length
      ? `Shared Chat with ${choices.map((peer) => peer.name).join(', ')}.`
      : 'Start a Shared Chat session to play together.';
    element<HTMLButtonElement>('startCollab').disabled =
      !peers.length ||
      !data.twitch.hostConnected ||
      data.arena.status === 'incoming' ||
      data.arena.status === 'active' ||
      data.arena.status === 'pending' ||
      this.busy;
    const practicing = data.arena.practice === 'realchat';
    element<HTMLButtonElement>('practiceLive').disabled =
      this.busy ||
      practicing ||
      !data.twitch.hostConnected ||
      !data.twitch.chatEventsConnected ||
      ['active', 'incoming', 'pending'].includes(data.arena.status);
    element('exitPractice').hidden = !practicing;
    element<HTMLButtonElement>('exitPractice').disabled = this.busy;
    element('practiceState').textContent = practicing
      ? 'TEST RAID · REAL TWITCH CHAT. Choose !join raiders or !join home before your first move, then follow the overlay.'
      : 'Play on your own overlay with real Twitch chat. Choose !join raiders or !join home, then type the word on screen.';
    element<HTMLButtonElement>('configureReward').disabled =
      !data.twitch.hostConnected || this.busy;
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
    element('approveReward').textContent = hosted ? 'Check approval' : 'Create This Reward';
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
