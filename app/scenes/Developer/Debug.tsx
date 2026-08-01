import { Link } from "react-router-dom";
import Heading from "~/components/Heading";
import Scene from "~/components/Scene";
import {
  debugChangesetsPath,
  debugEditorStressPath,
  debugFrameViewportPath,
} from "~/utils/routeHelpers";

export default function Debug() {
  return (
    <Scene title="Debug">
      <Heading>Debug</Heading>
      <ul style={{ paddingLeft: 16 }}>
        <li>
          <Link to={debugChangesetsPath()}>Changeset playground</Link>
        </li>
        <li>
          <Link to={debugEditorStressPath()}>Editor stress profiler</Link>
        </li>
        <li>
          <Link to={debugFrameViewportPath()}>Frame viewport fixture</Link>
        </li>
      </ul>
    </Scene>
  );
}
