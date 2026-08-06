/**
 * Player registration and the buy-in/rebuy/add-on/elimination actions.
 *
 * Deliberately has no chip-count input anywhere: a player's stack is never
 * typed in directly. Every number the dashboard shows (chips in play,
 * average stack, prize pool) derives from just two kinds of event this
 * component reports upward -- an entry (registration, rebuy, add-on) or an
 * elimination -- which is what `shared/tournament/stats.js` actually
 * computes from.
 */

const e = React.createElement;

/**
 * @param {object} props
 * @param {object[]} props.players
 * @param {'setup'|'active'|'completed'} props.status
 * @param {boolean} props.registrationOpen whether new players can still register
 * @param {(name: string) => void} props.onRegister
 * @param {(playerId: string, action: 'rebuy'|'addon'|'eliminate'|'reinstate') => void} props.onPlayerAction
 * @param {(playerId: string) => void} props.onRemove
 */
export function TournamentRoster({ players, status, registrationOpen, onRegister, onPlayerAction, onRemove }) {
  const [name, setName] = React.useState('');

  function submitRegistration(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onRegister(trimmed);
    setName('');
  }

  // Active players first (newest registration first within each group), then
  // eliminated players ordered by finishing place so the payout order reads top-down.
  const sorted = [...players].sort((a, b) => {
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
    if (a.eliminated) return (a.place ?? 0) - (b.place ?? 0);
    return 0;
  });

  return e(
    'div',
    { className: 'tournament-roster' },
    registrationOpen
      ? e(
          'form',
          { className: 'tournament-register-form', onSubmit: submitRegistration },
          e('input', {
            type: 'text',
            placeholder: 'Player name',
            value: name,
            onChange: event => setName(event.target.value),
            maxLength: 80
          }),
          e('button', { type: 'submit' }, 'Register')
        )
      : e('p', { className: 'footnote' }, 'Registration is closed -- no new players can be added.'),
    players.length === 0
      ? e('p', { className: 'footnote' }, 'No players registered yet.')
      : e(
          'ul',
          { className: 'tournament-player-list' },
          sorted.map(player =>
            e(
              'li',
              { key: player.id, className: `tournament-player-row ${player.eliminated ? 'is-eliminated' : ''}` },
              e(
                'div',
                { className: 'tournament-player-name' },
                player.eliminated ? e('span', { className: 'tournament-place-badge' }, `#${player.place}`) : null,
                player.name
              ),
              e(
                'div',
                { className: 'tournament-player-meta footnote' },
                `${player.rebuys} rebuy${player.rebuys === 1 ? '' : 's'}, ${player.addOns} add-on${player.addOns === 1 ? '' : 's'}`
              ),
              e(
                'div',
                { className: 'tournament-player-actions' },
                !player.eliminated
                  ? e(
                      React.Fragment,
                      null,
                      e('button', {
                        type: 'button',
                        className: 'ghost-button',
                        onClick: () => onPlayerAction(player.id, 'rebuy')
                      }, '+ Rebuy'),
                      e('button', {
                        type: 'button',
                        className: 'ghost-button',
                        onClick: () => onPlayerAction(player.id, 'addon')
                      }, '+ Add-on'),
                      e('button', {
                        type: 'button',
                        className: 'ghost-button danger',
                        onClick: () => onPlayerAction(player.id, 'eliminate')
                      }, 'Eliminate')
                    )
                  : e('button', {
                      type: 'button',
                      className: 'ghost-button',
                      onClick: () => onPlayerAction(player.id, 'reinstate')
                    }, 'Reinstate'),
                status === 'setup'
                  ? e('button', {
                      type: 'button',
                      className: 'ghost-button danger',
                      onClick: () => onRemove(player.id),
                      'aria-label': `Remove ${player.name}`
                    }, '×')
                  : null
              )
            )
          )
        )
  );
}
