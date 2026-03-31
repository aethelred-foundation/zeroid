/// Registry types for TEE node management.
use crate::attestation::report::Platform;

/// Status of a TEE node in the registry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeStatus {
    /// Node is registered but not yet active.
    Registered,
    /// Node is active and processing requests.
    Active,
    /// Node is active but showing signs of degradation.
    Degraded,
    /// Node is offline.
    Offline,
    /// Node has been deregistered.
    Deregistered,
}

impl NodeStatus {
    /// Return the human-readable name.
    pub fn name(&self) -> &'static str {
        match self {
            Self::Registered => "Registered",
            Self::Active => "Active",
            Self::Degraded => "Degraded",
            Self::Offline => "Offline",
            Self::Deregistered => "Deregistered",
        }
    }

    /// Whether the node can accept work.
    pub fn is_available(&self) -> bool {
        matches!(self, Self::Active | Self::Degraded)
    }
}

impl std::fmt::Display for NodeStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.name())
    }
}

/// Information about a registered TEE node.
#[derive(Debug, Clone, PartialEq)]
pub struct NodeInfo {
    /// Unique node identifier.
    pub node_id: String,
    /// Ethereum address of the node operator.
    pub operator: [u8; 20],
    /// TEE platform.
    pub platform: Platform,
    /// Enclave measurement hash.
    pub enclave_hash: [u8; 32],
    /// Current status.
    pub status: NodeStatus,
    /// Unix timestamp of last heartbeat.
    pub last_heartbeat: u64,
    /// Unix timestamp when the node was registered.
    pub registered_at: u64,
    /// Number of verifications performed.
    pub verification_count: u64,
}

impl NodeInfo {
    /// Create a new node info entry.
    pub fn new(
        node_id: impl Into<String>,
        operator: [u8; 20],
        platform: Platform,
        enclave_hash: [u8; 32],
        registered_at: u64,
    ) -> Self {
        Self {
            node_id: node_id.into(),
            operator,
            platform,
            enclave_hash,
            status: NodeStatus::Registered,
            last_heartbeat: registered_at,
            registered_at,
            verification_count: 0,
        }
    }

    /// Check whether the node is considered alive given a heartbeat timeout.
    pub fn is_alive(&self, now: u64, timeout_secs: u64) -> bool {
        if self.status == NodeStatus::Deregistered || self.status == NodeStatus::Offline {
            return false;
        }
        now.saturating_sub(self.last_heartbeat) <= timeout_secs
    }

    /// Record a heartbeat at the given timestamp.
    pub fn heartbeat(&mut self, now: u64) {
        self.last_heartbeat = now;
        if self.status == NodeStatus::Registered || self.status == NodeStatus::Offline {
            self.status = NodeStatus::Active;
        }
    }

    /// Increment the verification counter.
    pub fn record_verification(&mut self) {
        self.verification_count += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_node() -> NodeInfo {
        NodeInfo::new("node-1", [0xAA; 20], Platform::IntelSGX, [0xBB; 32], 1000)
    }

    #[test]
    fn node_status_name() {
        assert_eq!(NodeStatus::Registered.name(), "Registered");
        assert_eq!(NodeStatus::Active.name(), "Active");
        assert_eq!(NodeStatus::Degraded.name(), "Degraded");
        assert_eq!(NodeStatus::Offline.name(), "Offline");
        assert_eq!(NodeStatus::Deregistered.name(), "Deregistered");
    }

    #[test]
    fn node_status_display() {
        assert_eq!(format!("{}", NodeStatus::Active), "Active");
    }

    #[test]
    fn node_status_is_available() {
        assert!(!NodeStatus::Registered.is_available());
        assert!(NodeStatus::Active.is_available());
        assert!(NodeStatus::Degraded.is_available());
        assert!(!NodeStatus::Offline.is_available());
        assert!(!NodeStatus::Deregistered.is_available());
    }

    #[test]
    fn new_node_is_registered() {
        let node = sample_node();
        assert_eq!(node.status, NodeStatus::Registered);
        assert_eq!(node.verification_count, 0);
        assert_eq!(node.last_heartbeat, 1000);
    }

    #[test]
    fn is_alive_within_timeout() {
        let node = sample_node();
        assert!(node.is_alive(1050, 60));
    }

    #[test]
    fn is_alive_at_boundary() {
        let node = sample_node();
        assert!(node.is_alive(1060, 60));
    }

    #[test]
    fn is_alive_past_timeout() {
        let node = sample_node();
        assert!(!node.is_alive(1061, 60));
    }

    #[test]
    fn is_alive_deregistered() {
        let mut node = sample_node();
        node.status = NodeStatus::Deregistered;
        assert!(!node.is_alive(1000, 9999));
    }

    #[test]
    fn is_alive_offline() {
        let mut node = sample_node();
        node.status = NodeStatus::Offline;
        assert!(!node.is_alive(1000, 9999));
    }

    #[test]
    fn heartbeat_activates_registered() {
        let mut node = sample_node();
        assert_eq!(node.status, NodeStatus::Registered);
        node.heartbeat(2000);
        assert_eq!(node.status, NodeStatus::Active);
        assert_eq!(node.last_heartbeat, 2000);
    }

    #[test]
    fn heartbeat_activates_offline() {
        let mut node = sample_node();
        node.status = NodeStatus::Offline;
        node.heartbeat(3000);
        assert_eq!(node.status, NodeStatus::Active);
    }

    #[test]
    fn heartbeat_keeps_active() {
        let mut node = sample_node();
        node.status = NodeStatus::Active;
        node.heartbeat(2000);
        assert_eq!(node.status, NodeStatus::Active);
    }

    #[test]
    fn heartbeat_keeps_degraded() {
        let mut node = sample_node();
        node.status = NodeStatus::Degraded;
        node.heartbeat(2000);
        assert_eq!(node.status, NodeStatus::Degraded);
    }

    #[test]
    fn record_verification() {
        let mut node = sample_node();
        node.record_verification();
        assert_eq!(node.verification_count, 1);
        node.record_verification();
        assert_eq!(node.verification_count, 2);
    }

    #[test]
    fn node_clone_eq() {
        let node = sample_node();
        let node2 = node.clone();
        assert_eq!(node, node2);
    }

    #[test]
    fn node_debug() {
        let node = sample_node();
        let dbg = format!("{node:?}");
        assert!(dbg.contains("NodeInfo"));
    }

    #[test]
    fn node_status_copy() {
        let s = NodeStatus::Active;
        let s2 = s;
        assert_eq!(s, s2);
    }
}
