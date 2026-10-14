// 中継Worker（worker/）をデプロイしたら、そのURLを apiBase に入れてください。
// 例: apiBase: 'https://fudosan-sentei-api.<あなたのサブドメイン>.workers.dev'
// 空のままだと、地価・成約事例・ハザードの自動取得は行いません（リンク表示のみ）。
window.SENTEI_CONFIG = {
  apiBase: ''
};
