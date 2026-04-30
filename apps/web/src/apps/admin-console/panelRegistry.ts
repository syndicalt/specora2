import {
  Activity,
  ClipboardCheck,
  Database,
  Download,
  GitBranch,
  Hash,
  KeyRound,
  LayoutDashboard,
  Radio,
  Settings,
  Shield,
  ShieldCheck,
  Users,
} from "lucide-react";
import ChangeStateMachinePanel from "@/apps/change-manager/StateMachinePanel";

export const PANEL_COMPONENTS: Record<string, React.ComponentType<{ shell: any }>> = {
  "change-manager-state-machine": ChangeStateMachinePanel,
};

export const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Activity,
  ClipboardCheck,
  Database,
  Download,
  GitBranch,
  Hash,
  KeyRound,
  LayoutDashboard,
  Settings,
  Shield,
  ShieldCheck,
  Users,
  Radio,
};
