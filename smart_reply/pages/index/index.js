const db = wx.cloud.database();
const app = getApp();

Page({
  data: {
    comments: [],
    commentInputValue: '',
    replyInputs: {},
    page: 1,
    pageSize: 2,
    hasMore: true,
    loading: false, // 加载状态
    retryCount: 0, // 重试次数
    currentUserOpenid: '', // 当前用户的 OpenID
    isLoggedIn: false, // 用户是否已登录
    isPrivate: false, // 是否私密评论
    showOnlyMyComments: false, // 是否只显示自己的评论
  },

  onLoad: function() {
    this.getCurrentUserOpenid().then(() => {
      showOnlyMyComments: true;
      this.getComments();
    });
  },

  getCurrentUserOpenid: async function() {
    const res = await wx.cloud.callFunction({
      name: 'login',
      complete: res => {
        this.setData({ currentUserOpenid: res.result.openid, isLoggedIn: true });
      }
    });
  },

  getComments: async function() {
    if (this.data.loading) return;
    this.setData({ loading: true });

    const { page, pageSize, currentUserOpenid, showOnlyMyComments } = this.data;

    try {
      const res = await db.collection('comments')
        .orderBy('timestamp', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();

      const comments = res.data.filter(comment => {
        if (showOnlyMyComments) {
          return comment.authorOpenid === currentUserOpenid;
        }
        return !comment.isPrivate || comment.authorOpenid === currentUserOpenid;
      }).map(comment => ({
        ...comment,
        formattedTime: this.formatTime(comment.timestamp),
        replies: (comment.replies || []).filter(reply => {
          return !reply.isPrivate || reply.userOpenid === currentUserOpenid;
        }).map(reply => ({
          ...reply,
          formattedTime: this.formatTime(reply.timestamp)
        }))
      }));

      this.setData({
        comments: [...this.data.comments, ...comments],
        hasMore: comments.length === pageSize,
        loading: false
      });

      console.log('获取评论成功:', comments); // 查看解析后的数据
    } catch (err) {
      console.error('获取评论失败:', err);
      wx.showToast({
        title: '获取评论失败',
        icon: 'none',
        duration: 2000
      });
      this.setData({ loading: false });
    }
  },

  onScrollToLower: function() {
    if (this.data.hasMore && !this.data.loading) {
      this.setData({
        page: this.data.page + 1,
      }, () => {
        this.getComments();
        console.log("scroll to bottom");
      });
    } else {
      wx.showToast({
        title: '没有更多数据了',
        icon: 'none',
        duration: 2000
      });
    }
  },

  handleLike: async function(e) {
    const commentId = e.currentTarget.dataset.commentId;
    try {
      await db.collection('comments').doc(commentId).update({
        data: {
          likes: db.command.push('User'),
        }
      });
      console.log('Like successful:', commentId);
      this.getComments();
    } catch (err) {
      console.error('Failed to like:', err);
      wx.showToast({
        title: 'Failed to like',
        icon: 'none',
        duration: 2000,
      });
    }
  },

  handleReply: async function(e) {
    const commentId = e.currentTarget.dataset.commentId;
    const replyContent = this.data.replyInputs[commentId];
    if (!replyContent || replyContent.trim() === '') {
      wx.showToast({
        title: 'Say something~',
        icon: 'none',
        duration: 2000,
      });
      return;
    }

    try {
      await db.collection('comments').doc(commentId).update({
        data: {
          replies: db.command.push({
            userOpenid: this.data.currentUserOpenid,
            content: replyContent,
            timestamp: Date.now(),
            isPrivate: this.data.isPrivate // 私密回复
          })
        }
      });
      console.log('Reply successful:', commentId, replyContent);
      this.getComments();
      this.setData({ [`replyInput_${commentId}`]: '' });
    } catch (err) {
      console.error('Failed to reply:', err);
      wx.showToast({
        title: 'Failed to reply',
        icon: 'none',
        duration: 2000,
      });
    }
  },

  handleSubmit: async function() {
    const commentContent = this.data.commentInputValue.trim();
    if (commentContent === '') {
      wx.showToast({
        title: '说点啥呀~',
        icon: 'none',
        duration: 2000,
      });
      return;
    }

    try {
      wx.showLoading({ title: '提交中...' });
      const commentDoc = await db.collection('comments').add({
        data: {
          content: commentContent,
          author: 'User',
          authorOpenid: this.data.currentUserOpenid,
          likes: [],
          replies: [],
          timestamp: Date.now(),
          isPrivate: this.data.isPrivate // 私密评论
        }
      });
      console.log('Comment submitted successfully:', commentContent);

      let aiReply;
      try {
        aiReply = await this.getQwenReply(commentContent);
        console.log('AI Reply:', aiReply);
      } catch (err) {
        console.error('Failed to get AI reply:', err);
        if (this.data.retryCount < 2) {
          this.setData({ retryCount: this.data.retryCount + 1 });
          console.log(`Retrying... Attempt ${this.data.retryCount}`);
          aiReply = await this.getQwenReply(commentContent);
        } else {
          wx.showToast({
            title: '获取AI回复失败',
            icon: 'none',
            duration: 2000,
          });
          this.setData({ retryCount: 0 });
          return;
        }
      }

      await db.collection('comments').doc(commentDoc._id).update({
        data: {
          replies: db.command.push({
            userOpenid: '智子',
            content: aiReply,
            timestamp: Date.now(),
            isPrivate: false // AI 回复默认公开
          })
        }
      });

      this.setData({ 
        commentInputValue: '', 
        comments: [], 
        page: 1, 
        hasMore: true,
        retryCount: 0,
        isPrivate: false // 重置私密状态
      });
      this.getComments();
    } catch (err) {
      console.error('Failed to submit comment:', err);
      wx.showToast({
        title: 'Failed to submit comment',
        icon: 'none',
        duration: 2000,
      });
    } finally {
      wx.hideLoading();
    }
  },

  handleCommentInput: function(e) {
    this.setData({ commentInputValue: e.detail.value });
  },

  handleReplyInput: function(e) {
    const commentId = e.currentTarget.dataset.commentId;
    const replyContent = e.detail.value;
    this.setData({ [`replyInput_${commentId}`]: replyContent });
    this.data.replyInputs[commentId] = replyContent;
    console.log('Reply input:', commentId, replyContent);
  },

  formatTime: function(timestamp) {
    const date = new Date(timestamp * (timestamp < 10000000000 ? 1000 : 1));
    if (isNaN(date.getTime())) {
      console.error('Invalid timestamp:', timestamp);
      return 'Invalid Time';
    }

    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();
    const second = date.getSeconds();
    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`;
  },

  getQwenReply: async function(message) {
    try {
      const result = await wx.cloud.callFunction({
        name: 'getQwenReply',
        data: {
          message: message
        }
      });

      if (result.result.success) {
        console.log('AI 回复:', result.result.reply);
        return result.result.reply;
      } else {
        console.error('AI 请求失败:', result.result.error);
        throw new Error('AI 请求失败');
      }
    } catch (err) {
      console.error('调用云函数失败:', err);
      throw err;
    }
  },

  togglePrivacy: function(e) {
    this.setData({ isPrivate: e.detail.value });
  },

  showReplyInput: function(e) {
    const commentId = e.currentTarget.dataset.commentId;
    this.setData({ [`replyInput_${commentId}`]: '' });
  },

  handleLogin: async function() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'login',
        complete: res => {
          this.setData({ currentUserOpenid: res.result.openid, isLoggedIn: true });
          wx.showToast({
            title: '登录成功',
            icon: 'success',
            duration: 2000
          });
        }
      });
    } catch (err) {
      console.error('登录失败:', err);
      wx.showToast({
        title: '登录失败',
        icon: 'none',
        duration: 2000
      });
    }
  },

  handleEdit: async function(e) {
    const commentId = e.currentTarget.dataset.commentId;
    const newContent = prompt('请输入新的评论内容', '');
    if (!newContent || newContent.trim() === '') {
      wx.showToast({
        title: '内容不能为空',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    try {
      await db.collection('comments').doc(commentId).update({
        data: {
          content: newContent,
          timestamp: Date.now()
        }
      });
      console.log('编辑成功:', commentId, newContent);
      this.getComments();
    } catch (err) {
      console.error('编辑失败:', err);
      wx.showToast({
        title: '编辑失败',
        icon: 'none',
        duration: 2000
      });
    }
  },

  handleDelete: async function(e) {
    const commentId = e.currentTarget.dataset.commentId;
    try {
      await db.collection('comments').doc(commentId).remove();
      console.log('删除成功:', commentId);
      this.getComments();
    } catch (err) {
      console.error('删除失败:', err);
      wx.showToast({
        title: '删除失败',
        icon: 'none',
        duration: 2000
      });
    }
  },

  handleTogglePrivacy: async function(e) {
    const commentId = e.currentTarget.dataset.commentId;
    const comment = this.data.comments.find(c => c._id === commentId);
    const newIsPrivate = !comment.isPrivate;

    try {
      await db.collection('comments').doc(commentId).update({
        data: {
          isPrivate: newIsPrivate
        }
      });
      console.log('隐私状态更改成功:', commentId, newIsPrivate);
      this.getComments();
    } catch (err) {
      console.error('隐私状态更改失败:', err);
      wx.showToast({
        title: '隐私状态更改失败',
        icon: 'none',
        duration: 2000
      });
    }
  },

  handleShowOnlyMyComments: function() {
    this.setData({ showOnlyMyComments: !this.data.showOnlyMyComments, comments: [], page: 1, hasMore: true });
    this.getComments();
  },
});