import { Icon, Mark } from "../../design/ui";

interface Props {
  recent: { id: string; name: string; path: string }[];
  onOpen: (dir: string) => void;
  onChoose: () => void;
  onNew: () => void;
  onImport: () => void;
}

export function Start(p: Props) {
  return (
    <div className="start">
      <div className="mod start-card">
        <div className="start-brand">
          <Mark size={52} />
          <div>
            <div className="brand big">emquad</div>
            <div className="lab">Offline typesetter</div>
          </div>
        </div>
        <div className="start-acts">
          <button className="btn go" onClick={p.onNew}>
            <Icon name="plus" />
            New project
          </button>
          <button className="btn" onClick={p.onChoose}>
            <Icon name="folder" />
            Open folder
          </button>
          <button className="btn" onClick={p.onImport}>
            <Icon name="down" />
            Open bundle
          </button>
        </div>
        <div>
          <div className="lab" style={{ marginBottom: 10 }}>
            Recent projects
          </div>
          {p.recent.length === 0 && <p className="empty">Projects you open will be listed here.</p>}
          <div className="flist">
            {p.recent.map((r) => (
              <button key={r.path} className="recent" onClick={() => p.onOpen(r.path)}>
                <Icon name="folder" />
                <b>{r.name}</b>
                <span>{r.path}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
