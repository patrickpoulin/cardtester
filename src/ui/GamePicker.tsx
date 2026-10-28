import { DECK_FORMATS, builtinGame } from '../deckFormats';

interface Props {
  gameId: string;
  onChoose(gameId: string): void;
  disabled?: boolean;
}

/** The games on the site; the deck upload and the test below follow the one chosen here. */
export function GamePicker({ gameId, onChoose, disabled }: Props) {
  return (
    <section className="card">
      <h2>Choose a game</h2>
      <div className="game-picker" role="radiogroup" aria-label="Game">
        {DECK_FORMATS.map((f) => {
          const { game } = builtinGame(f.gameId);
          const players = game.minPlayers === game.maxPlayers ? `${game.minPlayers} players` : `${game.minPlayers}-${game.maxPlayers} players`;
          return (
            <button
              key={f.gameId}
              role="radio"
              aria-checked={gameId === f.gameId}
              className={gameId === f.gameId ? 'game-option selected' : 'game-option'}
              onClick={() => onChoose(f.gameId)}
              disabled={disabled}
            >
              <strong>{game.name}</strong>
              <span className="muted small">{players}</span>
              <span className="small">{game.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
