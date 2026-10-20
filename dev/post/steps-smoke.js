module.exports = [
  { name: 'title', shot: true, code: `T.ticks(30); T.frame(); T.frame(); return __K.post.stats();` },
  { name: 'a1-start', shot: true, code: `const G=__K.game; T.tapKey('Space'); T.ticks(4); T.until(() => G.state === 'play', 300); T.ticks(60); T.frame(); T.frame(); T.frame(); const s=__K.post.stats(); return {passes:s.passes, sc:s.sceneCalls, calls:s.calls, g:T.glStats()};` },
];
