const { TIME_OPTIONS, DEFAULT_GAME_TIME, TIME_READY } = require("../common/constants.js");
const { Message } = require("./Message.js");

const message = new Message();

class Queue {
  constructor() {
    this.queue = [];
    this.played = [];
    this.wantToPlayList = [];
    this.timer = undefined;
  }
  greet() {
    return `Приветствую!\nЯ бот для нормального управления очередью на игру в настольный теннис\n\nЧтобы мной пользоваться, напиши через @ мой ник в поле ввода сообщения и выбери нужный тебе пункт\n\nПриятной игры!`
  }
  setMessage({player1, player2, startDate, endDate}) {
    return `🏓 Создан матч между ${player1} и ${player2}\n🔔 Дается 30 секунд на подготовку\n⌚️ Время начала - ${startDate.toLocaleString("ru", TIME_OPTIONS)}\n🔚 Время окончания - ${endDate.toLocaleString("ru", TIME_OPTIONS)}
    `;
  }
  wantToPlay(player) {
    console.log(player, this.checkPlayerInSearch(player));
    
    if (!this.checkPlayer(player)) {
      this.wantToPlayList.push(player);
      return `${player} хочет поиграть. Кто составит ему компанию?`
    } else {
      if (this.checkPlayerInSearch(player)) {
        return `Игрок ${player} попытался попасть в поиск, но он уже в поиске`;
      } else if (this.checkPlayerInQueue(player)) {
        return `Игрок ${player} попытался попасть в поиск, но он уже в очереди`;
      } else if (this.checkPlayerInPlayed(player)) {
        return `Игрок ${player} попытался попасть в поиск, но он уже играл`;
      } else {
        return `Ты как сюда попал, ${player}?`;
      }
    }
  }
  removeFromSearch(player) {
    if (this.wantToPlayList.includes(player)) {
      this.wantToPlayList.splice(this.wantToPlayList.indexOf(player), 1);
    }
  }
  checkPlayer(player) {
    return this.checkPlayerInSearch(player) || this.checkPlayerInQueue(player) || this.checkPlayerInPlayed(player);
  }
  checkPlayerInSearch(player) {
    return this.wantToPlayList.indexOf(player) > -1;
  }
  checkPlayerInQueue(player) {
    return this.queue.findIndex((game) =>
      game.player1 === player || game.player2 === player
    ) > -1;
  }
  checkPlayerInPlayed(player) {
    return this.played.includes(player);
  }
  async setGameTimer(player1, player2) {
    return new Promise((resolve) => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        resolve(`Игра между ${player1} и ${player2} окончена!`);
      }, DEFAULT_GAME_TIME);
    });
  }
  clearGameTimer() {
    clearTimeout(this.timer);
  }
  add(player1, player2) {
    const playersAlreadyIn = this.queue.findIndex((game) =>
      game.player1 === player1 || game.player2 === player1 ||
      game.player2 === player1 || game.player2 === player2
    ) > -1;
    if (!playersAlreadyIn) {
      if (!this.played.includes(player1) && !this.played.includes(player2)) {
        const currentTimeStamp = new Date().getTime();
        const startDate =
          this.queue[this.queue.length - 1]?.endDate
            ? new Date(this.queue[this.queue.length - 1]?.endDate.getTime + TIME_READY)
            : new Date(currentTimeStamp + TIME_READY);
        const startTimestamp = startDate.getTime();
        const endDate = new Date(startTimestamp + (DEFAULT_GAME_TIME));
        const queueItem = {
          player1,
          player2,
          startDate,
          endDate,
          status: this.queue.length === 0 ? "Играют" : "Ожидают",
        };
        this.queue.push(queueItem);
        if (queueItem.status === "Играют") {
          setTimeout(() => {
            message.send(`${player1} и ${player2} начали игру!`);
            this.setGameTimer(player1, player2)
              .then((text) => {
                message.send(text);
                this.next();
              });
          }, TIME_READY)
        }
        return {
          status: 0,
          message: this.setMessage(queueItem)
        };
      } else {
        return {
          status: 1,
          message: "Один из игроков уже играл. Признавайтесь, кто?"
        }
      }
    } else {
      return {
        status: 1,
        message: "Один из игроков уже играет прямо сейчас"
      }
    }
  }
  async next() {
    const endedGame = this.queue.shift();
    if (endedGame) {
      this.played.push(endedGame.player1, endedGame.player2);
    }
    if (this.queue.length > 0) {
      this.queue[0].status = "Играют";
      message.send(`Следующая пара игроков - ${this.queue[0].player1} и ${this.queue[0].player2}\n\nНа подготовку дается 30 секунд`);
      setTimeout(() => {
        message.send(`${this.queue[0].player1} и ${this.queue[0].player2} начали игру`);
        this.setGameTimer(this.queue[0].player1, this.queue[0].player2)
          .then((text) => {
            message.send(text);
            this.next();
          });
      }, TIME_READY);
    }
  }
  removeByPlayer(player) {
    const indexOfGame = this.queue.findIndex((game) => game.player1 === player || game.player2 === player);
    if (indexOfGame > -1) {
      let timeRemains = DEFAULT_GAME_TIME;
      if (indexOfGame === 0) {
        const currentDate = new Date();
        timeRemains = timeRemains - (currentDate.getTime() - this.queue[indexOfGame].startDate.getTime());
      }
      this.queue.splice(indexOfGame, 1);
      if (this.queue.length > 0) {
        this.queue[0].status = "Играют";
        message.send(`Игрок ${player} отменил запись, время следующих пар игроков сдвигается на оставшееся время`);
        for (let i = indexOfGame; i < this.queue.length; i++) {
          this.queue[i].startDate = new Date(this.queue[i].startDate.getTime() - timeRemains);
          this.queue[i].endDate = new Date(this.queue[i].endDate.getTime() - timeRemains);
        }
      } else {
        message.send(`Игрок ${player} отменил запись`);
      }
    }
  }
  getList() {
    return this.queue.length > 0 ? this.queue.reduce((current, next, index) => current += `Матч №${index + 1}\nИграют ${next.player1} и ${next.player2}\nДата начала - ${next.startDate.toLocaleString("ru", TIME_OPTIONS)}\nДата окончания - ${next.endDate.toLocaleString("ru", TIME_OPTIONS)}\n\n`, "") : "Очередь пуста";
  }
  getPlayedList() {
    return this.played.length ? `Отыгравшие игроки: \n${this.played.join("\n")}` : "Еще никто не играл, самое время встать в очередь";
  }
}

module.exports = Queue;