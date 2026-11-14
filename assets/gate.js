/* 예약 공개 영상 칸 (11-10): <div class="vplayer" data-yt="영상ID" data-at="UTC 공개 시각" data-title="제목"><img …></div>
   공개 시각 전 = 썸네일 + "MM/DD (요일) HH:MM 공개" 표시 (예약 비공개 영상은 퍼가기에서 "비공개 동영상"으로 보이므로)
   공개 시각 뒤 = 유튜브 영상. 다시 배포하지 않아도 시각이 지나면 저절로 바뀜 */
(function () {
  var D = "일월화수목금토";
  document.querySelectorAll(".vplayer[data-yt]").forEach(function (b) {
    var at = Date.parse(b.dataset.at || "");
    if (!at || Date.now() >= at) {
      b.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + b.dataset.yt + '" title="' + (b.dataset.title || "") +
        '" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>';
      return;
    }
    var k = new Date(at + 9 * 3600 * 1000), p = function (n) { return (n < 10 ? "0" : "") + n; };
    var s = document.createElement("span");
    s.className = "soon-badge";
    s.textContent = (k.getUTCMonth() + 1) + "/" + k.getUTCDate() + " (" + D[k.getUTCDay()] + ") " + p(k.getUTCHours()) + ":" + p(k.getUTCMinutes()) + " 공개";
    b.appendChild(s);
  });
})();
