const status = document.getElementById('status')

chrome.runtime
  .sendMessage('check-in')
  .then((apps) => {
    if (apps && apps.length) {
      status.textContent = `Connected to Waypoint ${apps[0].version}`
      status.className = 'status ok'
    } else {
      status.textContent = "Waypoint isn't running on this PC"
      status.className = 'status bad'
    }
  })
  .catch(() => {
    status.textContent = "Couldn't reach Waypoint"
    status.className = 'status bad'
  })
