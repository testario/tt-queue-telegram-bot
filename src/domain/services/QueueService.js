import { Match } from "../entities/Match.js";
import { QueueState } from "../entities/QueueState.js";

class QueueService {
  constructor({ readyMs, gameMs }) {
    this.readyMs = readyMs;
    this.gameMs = gameMs;
  }

  createInitialState() {
    return QueueState.createEmpty();
  }

  registerSearch(state, player) {
    const nextState = state.clone();
    if (!nextState.hasPlayer(player)) {
      nextState.addSearching(player);
      return { state: nextState, status: "added" };
    }
    if (nextState.isSearching(player)) {
      return { state: nextState, status: "already_searching" };
    }
    if (nextState.isQueued(player)) {
      return { state: nextState, status: "in_queue" };
    }
    if (nextState.isPlayed(player)) {
      return { state: nextState, status: "played" };
    }
    return { state: nextState, status: "unknown" };
  }

  cancelSearch(state, player) {
    const nextState = state.clone();
    if (nextState.isSearching(player)) {
      nextState.removeSearching(player);
      return { state: nextState, status: "removed" };
    }
    return { state: nextState, status: "not_found" };
  }

  scheduleMatch(state, player1, player2, now) {
    if (player1 === player2) {
      return { ok: false, reason: "same_player", state };
    }
    const nextState = state.clone();
    if (nextState.isPlayed(player1) || nextState.isPlayed(player2)) {
      return { ok: false, reason: "already_played", state: nextState };
    }
    if (nextState.isQueued(player1) || nextState.isQueued(player2)) {
      return { ok: false, reason: "already_in_queue", state: nextState };
    }
    if (!nextState.isSearching(player1)) {
      return { ok: false, reason: "player1_not_searching", state: nextState };
    }

    nextState.removeSearching(player1);

    const lastMatch = nextState.queue[nextState.queue.length - 1];
    const baseStart = lastMatch ? lastMatch.endDate : now;
    const startDate = new Date(baseStart.getTime() + this.readyMs);
    const endDate = new Date(startDate.getTime() + this.gameMs);
    const status =
      nextState.queue.length === 0
        ? Match.statuses.playing
        : Match.statuses.waiting;

    const match = Match.create({
      player1,
      player2,
      startDate,
      endDate,
      status,
    });

    nextState.enqueue(match);

    return { ok: true, state: nextState, match };
  }

  finishCurrent(state, now) {
    const nextState = state.clone();
    const endedMatch = nextState.shiftQueue();
    let nextMatch = null;

    if (endedMatch) {
      nextState.played.push(endedMatch.player1, endedMatch.player2);
    }

    if (nextState.queue.length > 0) {
      const current = nextState.queue[0];
      current.status = Match.statuses.playing;
      current.startDate = new Date(now.getTime() + this.readyMs);
      current.endDate = new Date(current.startDate.getTime() + this.gameMs);
      nextMatch = current;
      this.recalculateWaiting(nextState);
    }

    return { state: nextState, endedMatch, nextMatch };
  }

  cancelMatch(state, player, now) {
    const nextState = state.clone();
    const { match, index } = nextState.removeMatchByPlayer(player);

    if (!match) {
      return { state: nextState, status: "not_found" };
    }

    if (index === 0) {
      const currentTime = now.getTime();
      const elapsed = Math.max(0, currentTime - match.startDate.getTime());
      const remains = Math.max(0, this.gameMs - elapsed);

      let nextMatch = null;
      if (nextState.queue.length > 0) {
        const current = nextState.queue[0];
        current.status = Match.statuses.playing;
        current.startDate = new Date(currentTime + this.readyMs);
        current.endDate = new Date(current.startDate.getTime() + this.gameMs);
        nextMatch = current;
        this.recalculateWaiting(nextState);
      }

      return {
        state: nextState,
        status: "removed_current",
        removedMatch: match,
        nextMatch,
        remains,
      };
    }

    this.recalculateWaiting(nextState);
    return {
      state: nextState,
      status: "removed_waiting",
      removedMatch: match,
    };
  }

  recalculateWaiting(state) {
    if (state.queue.length === 0) return;

    let previous = state.queue[0];
    for (let i = 1; i < state.queue.length; i++) {
      const match = state.queue[i];
      match.status = Match.statuses.waiting;
      match.startDate = new Date(previous.endDate.getTime() + this.readyMs);
      match.endDate = new Date(match.startDate.getTime() + this.gameMs);
      previous = match;
    }
  }
}

export { QueueService };

