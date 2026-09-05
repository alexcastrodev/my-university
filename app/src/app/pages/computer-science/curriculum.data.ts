/**
 * Static registry of the Computer Science curriculum tree, mirroring the folder slugs
 * under `backend/src/seed/data/curriculum/`. There is no semester/timeline here — a
 * module is just a parent grouping; `specialization` is the one module whose children
 * are further modules (tracks) instead of disciplines directly. All content is currently
 * empty (`concepts.json: []` on the backend) — this registry only exists to make the
 * structure browsable before any discipline has content.
 */
export interface CurriculumDiscipline {
  slug: string;
  title: string;
  hours?: number;
  topics: string[];
}

export interface CurriculumModule {
  slug: string;
  title: string;
  disciplines?: CurriculumDiscipline[];
  tracks?: CurriculumModule[];
}

export const CURRICULUM: CurriculumModule[] = [
  {
    slug: 'foundations',
    title: 'Foundations of Computer Science',
    disciplines: [
      {
        slug: 'programming-computational-thinking',
        title: 'Programming & Computational Thinking',
        hours: 80,
        topics: ['programming', 'abstraction', 'functions', 'recursion', 'decomposition'],
      },
      {
        slug: 'discrete-math-logic',
        title: 'Discrete Mathematics & Logic',
        hours: 80,
        topics: ['propositional logic', 'predicate logic', 'sets', 'induction', 'proofs', 'combinatorics'],
      },
      {
        slug: 'data-structures-i',
        title: 'Data Structures I',
        hours: 60,
        topics: ['arrays', 'linked lists', 'stacks', 'queues', 'hash tables', 'trees'],
      },
      {
        slug: 'probability-statistics',
        title: 'Probability & Statistics',
        hours: 60,
        topics: ['foundation for algorithms, AI, ML, and research'],
      },
      {
        slug: 'mathematics-for-computing',
        title: 'Mathematics for Computing',
        hours: 60,
        topics: ['linear algebra'],
      },
      {
        slug: 'questions-scientific-thinking',
        title: 'Questions & Scientific Thinking',
        hours: 60,
        topics: ['turning curiosity into a computational question'],
      },
    ],
  },
  {
    slug: 'algorithms-software',
    title: 'Algorithms & Software',
    disciplines: [
      {
        slug: 'data-structures-ii',
        title: 'Data Structures II',
        hours: 60,
        topics: ['balanced trees', 'heaps', 'graphs', 'tries', 'union-find'],
      },
      {
        slug: 'algorithms',
        title: 'Algorithms',
        hours: 80,
        topics: ['sorting', 'searching', 'divide & conquer', 'greedy', 'dynamic programming', 'graph algorithms', 'shortest paths', 'MST'],
      },
      {
        slug: 'software-construction',
        title: 'Software Construction',
        hours: 80,
        topics: ['modularity', 'testing', 'debugging', 'version control', 'API design', 'software architecture'],
      },
      {
        slug: 'programming-paradigms',
        title: 'Programming Paradigms',
        hours: 60,
        topics: ['imperative', 'object-oriented', 'functional', 'logic', 'concurrent', 'declarative'],
      },
      {
        slug: 'computability-complexity',
        title: 'Computability & Complexity',
        hours: 60,
        topics: ['Turing machines', 'decidability', 'reductions', 'P/NP', 'complexity classes'],
      },
      {
        slug: 'algorithm-laboratory',
        title: 'Algorithm Laboratory',
        hours: 60,
        topics: ['Dijkstra', 'A*', 'PageRank', 'hash tables', 'B-trees', 'sorting algorithms'],
      },
    ],
  },
  {
    slug: 'computer',
    title: 'How Computers Actually Work',
    disciplines: [
      {
        slug: 'digital-logic-computer-organization',
        title: 'Digital Logic & Computer Organization',
        hours: 80,
        topics: ['logic gates', 'ALU', 'CPU', 'memory', 'instruction set', 'computer'],
      },
      {
        slug: 'c-and-assembly',
        title: 'C & Assembly',
        hours: 60,
        topics: ['pointers', 'memory', 'stack', 'heap', 'assembly', 'ABI', 'calling conventions'],
      },
      {
        slug: 'computer-architecture',
        title: 'Computer Architecture',
        hours: 80,
        topics: ['pipelines', 'cache', 'branch prediction', 'memory hierarchy', 'multicore', 'SIMD', 'GPUs'],
      },
      {
        slug: 'operating-systems-i',
        title: 'Operating Systems I',
        hours: 80,
        topics: ['processes', 'threads', 'scheduling', 'virtual memory', 'filesystem', 'concurrency'],
      },
      {
        slug: 'systems-laboratory',
        title: 'Systems Laboratory',
        hours: 100,
        topics: ['build a CPU', 'assembly', 'C', 'memory manager', 'scheduler', 'file system'],
      },
    ],
  },
  {
    slug: 'systems',
    title: 'Systems',
    disciplines: [
      {
        slug: 'operating-systems-ii',
        title: 'Operating Systems II',
        hours: 60,
        topics: ['kernel', 'system calls', 'IPC', 'synchronization', 'virtualization', 'security boundaries'],
      },
      {
        slug: 'computer-networks',
        title: 'Computer Networks',
        hours: 80,
        topics: ['physical', 'link', 'IP', 'routing', 'TCP', 'HTTP', 'distributed applications'],
      },
      {
        slug: 'database-systems',
        title: 'Database Systems',
        hours: 80,
        topics: ['relational model', 'SQL', 'storage engines', 'indexes', 'query optimizer', 'transactions', 'recovery'],
      },
      {
        slug: 'distributed-systems-i',
        title: 'Distributed Systems I',
        hours: 80,
        topics: ['clocks', 'RPC', 'replication', 'consistency', 'consensus', 'fault tolerance'],
      },
      {
        slug: 'systems-laboratory',
        title: 'Systems Laboratory',
        hours: 100,
        topics: ['build a distributed key-value store: client, RPC, replication, failure, consensus'],
      },
    ],
  },
  {
    slug: 'software-distributed',
    title: 'Software + Distributed Computing',
    disciplines: [
      {
        slug: 'software-engineering',
        title: 'Software Engineering',
        hours: 60,
        topics: ['requirements', 'architecture', 'testing', 'CI/CD', 'observability', 'technical debt'],
      },
      {
        slug: 'distributed-systems-ii',
        title: 'Distributed Systems II',
        hours: 80,
        topics: ['Raft', 'Paxos', 'Byzantine fault tolerance', 'distributed databases', 'eventual consistency', 'CRDTs'],
      },
      {
        slug: 'programming-languages',
        title: 'Programming Languages',
        hours: 60,
        topics: ['interpreters', 'type systems', 'semantics', 'functional programming', 'runtime systems'],
      },
      {
        slug: 'compilers',
        title: 'Compilers',
        hours: 80,
        topics: ['lexer', 'parser', 'AST', 'semantic analysis', 'IR', 'optimization', 'machine code'],
      },
      {
        slug: 'security-cryptography',
        title: 'Security & Cryptography',
        hours: 60,
        topics: ['cryptography', 'authentication', 'authorization', 'secure systems', 'network security', 'threat modeling'],
      },
      {
        slug: 'distributed-systems-laboratory',
        title: 'Distributed Systems Lab',
        hours: 80,
        topics: ['build a replicated database, then break it: partition, node failure, clock skew, packet loss'],
      },
    ],
  },
  {
    slug: 'ai-theory',
    title: 'Intelligence + Theory',
    disciplines: [
      {
        slug: 'artificial-intelligence',
        title: 'Artificial Intelligence',
        hours: 80,
        topics: ['search', 'planning', 'knowledge representation', 'reasoning', 'decision making', 'probabilistic AI'],
      },
      {
        slug: 'machine-learning',
        title: 'Machine Learning',
        hours: 80,
        topics: ['probability', 'linear algebra', 'optimization', 'machine learning', 'deep learning'],
      },
      {
        slug: 'deep-learning',
        title: 'Deep Learning',
        hours: 60,
        topics: ['neural networks', 'CNNs', 'RNNs', 'transformers', 'representation learning', 'generative models'],
      },
      {
        slug: 'information-theory',
        title: 'Information Theory',
        hours: 60,
        topics: ['entropy', 'information', 'compression', 'communication', 'coding', 'information limits'],
      },
      {
        slug: 'formal-methods',
        title: 'Formal Methods',
        hours: 60,
        topics: ['formal specification', 'verification', 'model checking', 'theorem proving', 'program correctness'],
      },
      {
        slug: 'ai-ml-laboratory',
        title: 'AI / ML Laboratory',
        hours: 100,
        topics: ['question', 'hypothesis', 'dataset', 'model', 'experiment', 'evaluation', 'reproduce', 'challenge'],
      },
    ],
  },
  {
    slug: 'specialization',
    title: 'Specialization',
    tracks: [
      {
        slug: 'track-a-systems',
        title: 'Track A — Systems',
        disciplines: [{ slug: 'systems', title: 'Systems depth', topics: ['advanced OS', 'distributed systems', 'databases', 'cloud computing', 'high performance computing', 'computer architecture'] }],
      },
      {
        slug: 'track-b-ai',
        title: 'Track B — AI',
        disciplines: [{ slug: 'ai', title: 'AI depth', topics: ['advanced machine learning', 'deep learning', 'computer vision', 'NLP', 'reinforcement learning', 'generative AI'] }],
      },
      {
        slug: 'track-c-theory',
        title: 'Track C — Theory',
        disciplines: [{ slug: 'theory', title: 'Theory depth', topics: ['advanced algorithms', 'complexity', 'cryptography', 'information theory', 'formal methods', 'computational geometry'] }],
      },
      {
        slug: 'track-d-software',
        title: 'Track D — Software',
        disciplines: [{ slug: 'software', title: 'Software depth', topics: ['programming languages', 'compilers', 'type systems', 'program analysis', 'software verification', 'developer tools'] }],
      },
      {
        slug: 'track-e-human-computing',
        title: 'Track E — Human Computing',
        disciplines: [{ slug: 'human-computing', title: 'Human computing depth', topics: ['HCI', 'graphics', 'visualization', 'computer vision', 'interaction'] }],
      },
      {
        slug: 'track-f-robotics',
        title: 'Track F — Robotics',
        disciplines: [{ slug: 'robotics', title: 'Robotics depth', topics: ['robotics', 'control', 'computer vision', 'planning', 'robot learning', 'autonomous systems'] }],
      },
    ],
  },
  {
    slug: 'research',
    title: 'Research & Independent Computing',
    disciplines: [
      {
        slug: 'independent-research',
        title: 'Independent Research',
        topics: ['question', 'literature', 'papers', 'hypothesis', 'implementation', 'experiment', 'result', 'reflection', 'new question'],
      },
    ],
  },
];
