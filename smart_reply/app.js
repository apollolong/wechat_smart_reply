App({
  onLaunch: function() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'haleycloud-1gro2i1qe948948d', // 你的环境 ID
        traceUser: true,
      });
    }
  }
});
