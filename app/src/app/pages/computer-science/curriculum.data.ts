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
    title: $localize`:@@curriculum.module.foundations:Foundations of Computer Science`,
    disciplines: [
      {
        slug: 'programming-computational-thinking',
        title: $localize`:@@curriculum.foundations.programming-computational-thinking.title:Programming & Computational Thinking`,
        hours: 80,
        topics: [
          $localize`:@@curriculum.foundations.programming-computational-thinking.topic.1:programming`,
          $localize`:@@curriculum.foundations.programming-computational-thinking.topic.2:abstraction`,
          $localize`:@@curriculum.foundations.programming-computational-thinking.topic.3:functions`,
          $localize`:@@curriculum.foundations.programming-computational-thinking.topic.4:recursion`,
          $localize`:@@curriculum.foundations.programming-computational-thinking.topic.5:decomposition`,
        ],
      },
      {
        slug: 'discrete-math-logic',
        title: $localize`:@@curriculum.foundations.discrete-math-logic.title:Discrete Mathematics & Logic`,
        hours: 80,
        topics: [
          $localize`:@@curriculum.foundations.discrete-math-logic.topic.1:propositional logic`,
          $localize`:@@curriculum.foundations.discrete-math-logic.topic.2:predicate logic`,
          $localize`:@@curriculum.foundations.discrete-math-logic.topic.3:sets`,
          $localize`:@@curriculum.foundations.discrete-math-logic.topic.4:induction`,
          $localize`:@@curriculum.foundations.discrete-math-logic.topic.5:proofs`,
          $localize`:@@curriculum.foundations.discrete-math-logic.topic.6:combinatorics`,
        ],
      },
      {
        slug: 'data-structures-i',
        title: $localize`:@@curriculum.foundations.data-structures-i.title:Data Structures I`,
        hours: 60,
        topics: [
          $localize`:@@curriculum.foundations.data-structures-i.topic.1:arrays`,
          $localize`:@@curriculum.foundations.data-structures-i.topic.2:linked lists`,
          $localize`:@@curriculum.foundations.data-structures-i.topic.3:stacks`,
          $localize`:@@curriculum.foundations.data-structures-i.topic.4:queues`,
          $localize`:@@curriculum.foundations.data-structures-i.topic.5:hash tables`,
          $localize`:@@curriculum.foundations.data-structures-i.topic.6:trees`,
        ],
      },
      {
        slug: 'probability-statistics',
        title: $localize`:@@curriculum.foundations.probability-statistics.title:Probability & Statistics`,
        hours: 60,
        topics: [$localize`:@@curriculum.foundations.probability-statistics.topic.1:foundation for algorithms, AI, ML, and research`],
      },
      {
        slug: 'mathematics-for-computing',
        title: $localize`:@@curriculum.foundations.mathematics-for-computing.title:Mathematics for Computing`,
        hours: 60,
        topics: [$localize`:@@curriculum.foundations.mathematics-for-computing.topic.1:linear algebra`],
      },
      {
        slug: 'questions-scientific-thinking',
        title: $localize`:@@curriculum.foundations.questions-scientific-thinking.title:Questions & Scientific Thinking`,
        hours: 60,
        topics: [$localize`:@@curriculum.foundations.questions-scientific-thinking.topic.1:turning curiosity into a computational question`],
      },
    ],
  },
  {
    slug: 'algorithms-software',
    title: $localize`:@@curriculum.module.algorithms-software:Algorithms & Software`,
    disciplines: [
      {
        slug: 'data-structures-ii',
        title: $localize`:@@curriculum.algorithms-software.data-structures-ii.title:Data Structures II`,
        hours: 60,
        topics: [
          $localize`:@@curriculum.algorithms-software.data-structures-ii.topic.1:balanced trees`,
          $localize`:@@curriculum.algorithms-software.data-structures-ii.topic.2:heaps`,
          $localize`:@@curriculum.algorithms-software.data-structures-ii.topic.3:graphs`,
          $localize`:@@curriculum.algorithms-software.data-structures-ii.topic.4:tries`,
          $localize`:@@curriculum.algorithms-software.data-structures-ii.topic.5:union-find`,
        ],
      },
      {
        slug: 'algorithms',
        title: $localize`:@@curriculum.algorithms-software.algorithms.title:Algorithms`,
        hours: 80,
        topics: [
          $localize`:@@curriculum.algorithms-software.algorithms.topic.1:sorting`,
          $localize`:@@curriculum.algorithms-software.algorithms.topic.2:searching`,
          $localize`:@@curriculum.algorithms-software.algorithms.topic.3:divide & conquer`,
          $localize`:@@curriculum.algorithms-software.algorithms.topic.4:greedy`,
          $localize`:@@curriculum.algorithms-software.algorithms.topic.5:dynamic programming`,
          $localize`:@@curriculum.algorithms-software.algorithms.topic.6:graph algorithms`,
          $localize`:@@curriculum.algorithms-software.algorithms.topic.7:shortest paths`,
          $localize`:@@curriculum.algorithms-software.algorithms.topic.8:MST`,
        ],
      },
      {
        slug: 'software-construction',
        title: $localize`:@@curriculum.algorithms-software.software-construction.title:Software Construction`,
        hours: 80,
        topics: [
          $localize`:@@curriculum.algorithms-software.software-construction.topic.1:modularity`,
          $localize`:@@curriculum.algorithms-software.software-construction.topic.2:testing`,
          $localize`:@@curriculum.algorithms-software.software-construction.topic.3:debugging`,
          $localize`:@@curriculum.algorithms-software.software-construction.topic.4:version control`,
          $localize`:@@curriculum.algorithms-software.software-construction.topic.5:API design`,
          $localize`:@@curriculum.algorithms-software.software-construction.topic.6:software architecture`,
        ],
      },
      {
        slug: 'programming-paradigms',
        title: $localize`:@@curriculum.algorithms-software.programming-paradigms.title:Programming Paradigms`,
        hours: 60,
        topics: [
          $localize`:@@curriculum.algorithms-software.programming-paradigms.topic.1:imperative`,
          $localize`:@@curriculum.algorithms-software.programming-paradigms.topic.2:object-oriented`,
          $localize`:@@curriculum.algorithms-software.programming-paradigms.topic.3:functional`,
          $localize`:@@curriculum.algorithms-software.programming-paradigms.topic.4:logic`,
          $localize`:@@curriculum.algorithms-software.programming-paradigms.topic.5:concurrent`,
          $localize`:@@curriculum.algorithms-software.programming-paradigms.topic.6:declarative`,
        ],
      },
      {
        slug: 'computability-complexity',
        title: $localize`:@@curriculum.algorithms-software.computability-complexity.title:Computability & Complexity`,
        hours: 60,
        topics: [
          $localize`:@@curriculum.algorithms-software.computability-complexity.topic.1:Turing machines`,
          $localize`:@@curriculum.algorithms-software.computability-complexity.topic.2:decidability`,
          $localize`:@@curriculum.algorithms-software.computability-complexity.topic.3:reductions`,
          $localize`:@@curriculum.algorithms-software.computability-complexity.topic.4:P/NP`,
          $localize`:@@curriculum.algorithms-software.computability-complexity.topic.5:complexity classes`,
        ],
      },
      {
        slug: 'algorithm-laboratory',
        title: $localize`:@@curriculum.algorithms-software.algorithm-laboratory.title:Algorithm Laboratory`,
        hours: 60,
        topics: [
          $localize`:@@curriculum.algorithms-software.algorithm-laboratory.topic.1:Dijkstra`,
          $localize`:@@curriculum.algorithms-software.algorithm-laboratory.topic.2:A*`,
          $localize`:@@curriculum.algorithms-software.algorithm-laboratory.topic.3:PageRank`,
          $localize`:@@curriculum.algorithms-software.algorithm-laboratory.topic.4:hash tables`,
          $localize`:@@curriculum.algorithms-software.algorithm-laboratory.topic.5:B-trees`,
          $localize`:@@curriculum.algorithms-software.algorithm-laboratory.topic.6:sorting algorithms`,
        ],
      },
    ],
  },
  {
    slug: 'computer',
    title: $localize`:@@curriculum.module.computer:How Computers Actually Work`,
    disciplines: [
      {
        slug: 'digital-logic-computer-organization',
        title: $localize`:@@curriculum.computer.digital-logic-computer-organization.title:Digital Logic & Computer Organization`,
        hours: 80,
        topics: [
          $localize`:@@curriculum.computer.digital-logic-computer-organization.topic.1:logic gates`,
          $localize`:@@curriculum.computer.digital-logic-computer-organization.topic.2:ALU`,
          $localize`:@@curriculum.computer.digital-logic-computer-organization.topic.3:CPU`,
          $localize`:@@curriculum.computer.digital-logic-computer-organization.topic.4:memory`,
          $localize`:@@curriculum.computer.digital-logic-computer-organization.topic.5:instruction set`,
          $localize`:@@curriculum.computer.digital-logic-computer-organization.topic.6:computer`,
        ],
      },
      {
        slug: 'c-and-assembly',
        title: $localize`:@@curriculum.computer.c-and-assembly.title:C & Assembly`,
        hours: 60,
        topics: [
          $localize`:@@curriculum.computer.c-and-assembly.topic.1:pointers`,
          $localize`:@@curriculum.computer.c-and-assembly.topic.2:memory`,
          $localize`:@@curriculum.computer.c-and-assembly.topic.3:stack`,
          $localize`:@@curriculum.computer.c-and-assembly.topic.4:heap`,
          $localize`:@@curriculum.computer.c-and-assembly.topic.5:assembly`,
          $localize`:@@curriculum.computer.c-and-assembly.topic.6:ABI`,
          $localize`:@@curriculum.computer.c-and-assembly.topic.7:calling conventions`,
        ],
      },
      {
        slug: 'computer-architecture',
        title: $localize`:@@curriculum.computer.computer-architecture.title:Computer Architecture`,
        hours: 80,
        topics: [
          $localize`:@@curriculum.computer.computer-architecture.topic.1:pipelines`,
          $localize`:@@curriculum.computer.computer-architecture.topic.2:cache`,
          $localize`:@@curriculum.computer.computer-architecture.topic.3:branch prediction`,
          $localize`:@@curriculum.computer.computer-architecture.topic.4:memory hierarchy`,
          $localize`:@@curriculum.computer.computer-architecture.topic.5:multicore`,
          $localize`:@@curriculum.computer.computer-architecture.topic.6:SIMD`,
          $localize`:@@curriculum.computer.computer-architecture.topic.7:GPUs`,
        ],
      },
      {
        slug: 'operating-systems-i',
        title: $localize`:@@curriculum.computer.operating-systems-i.title:Operating Systems I`,
        hours: 80,
        topics: [
          $localize`:@@curriculum.computer.operating-systems-i.topic.1:processes`,
          $localize`:@@curriculum.computer.operating-systems-i.topic.2:threads`,
          $localize`:@@curriculum.computer.operating-systems-i.topic.3:scheduling`,
          $localize`:@@curriculum.computer.operating-systems-i.topic.4:virtual memory`,
          $localize`:@@curriculum.computer.operating-systems-i.topic.5:filesystem`,
          $localize`:@@curriculum.computer.operating-systems-i.topic.6:concurrency`,
        ],
      },
      {
        slug: 'systems-laboratory',
        title: $localize`:@@curriculum.computer.systems-laboratory.title:Systems Laboratory`,
        hours: 100,
        topics: [
          $localize`:@@curriculum.computer.systems-laboratory.topic.1:build a CPU`,
          $localize`:@@curriculum.computer.systems-laboratory.topic.2:assembly`,
          $localize`:@@curriculum.computer.systems-laboratory.topic.3:C`,
          $localize`:@@curriculum.computer.systems-laboratory.topic.4:memory manager`,
          $localize`:@@curriculum.computer.systems-laboratory.topic.5:scheduler`,
          $localize`:@@curriculum.computer.systems-laboratory.topic.6:file system`,
        ],
      },
    ],
  },
  {
    slug: 'systems',
    title: $localize`:@@curriculum.module.systems:Systems`,
    disciplines: [
      {
        slug: 'operating-systems-ii',
        title: $localize`:@@curriculum.systems.operating-systems-ii.title:Operating Systems II`,
        hours: 60,
        topics: [
          $localize`:@@curriculum.systems.operating-systems-ii.topic.1:kernel`,
          $localize`:@@curriculum.systems.operating-systems-ii.topic.2:system calls`,
          $localize`:@@curriculum.systems.operating-systems-ii.topic.3:IPC`,
          $localize`:@@curriculum.systems.operating-systems-ii.topic.4:synchronization`,
          $localize`:@@curriculum.systems.operating-systems-ii.topic.5:virtualization`,
          $localize`:@@curriculum.systems.operating-systems-ii.topic.6:security boundaries`,
        ],
      },
      {
        slug: 'computer-networks',
        title: $localize`:@@curriculum.systems.computer-networks.title:Computer Networks`,
        hours: 80,
        topics: [
          $localize`:@@curriculum.systems.computer-networks.topic.1:physical`,
          $localize`:@@curriculum.systems.computer-networks.topic.2:link`,
          $localize`:@@curriculum.systems.computer-networks.topic.3:IP`,
          $localize`:@@curriculum.systems.computer-networks.topic.4:routing`,
          $localize`:@@curriculum.systems.computer-networks.topic.5:TCP`,
          $localize`:@@curriculum.systems.computer-networks.topic.6:HTTP`,
          $localize`:@@curriculum.systems.computer-networks.topic.7:distributed applications`,
        ],
      },
      {
        slug: 'database-systems',
        title: $localize`:@@curriculum.systems.database-systems.title:Database Systems`,
        hours: 80,
        topics: [
          $localize`:@@curriculum.systems.database-systems.topic.1:relational model`,
          $localize`:@@curriculum.systems.database-systems.topic.2:SQL`,
          $localize`:@@curriculum.systems.database-systems.topic.3:storage engines`,
          $localize`:@@curriculum.systems.database-systems.topic.4:indexes`,
          $localize`:@@curriculum.systems.database-systems.topic.5:query optimizer`,
          $localize`:@@curriculum.systems.database-systems.topic.6:transactions`,
          $localize`:@@curriculum.systems.database-systems.topic.7:recovery`,
        ],
      },
      {
        slug: 'distributed-systems-i',
        title: $localize`:@@curriculum.systems.distributed-systems-i.title:Distributed Systems I`,
        hours: 80,
        topics: [
          $localize`:@@curriculum.systems.distributed-systems-i.topic.1:clocks`,
          $localize`:@@curriculum.systems.distributed-systems-i.topic.2:RPC`,
          $localize`:@@curriculum.systems.distributed-systems-i.topic.3:replication`,
          $localize`:@@curriculum.systems.distributed-systems-i.topic.4:consistency`,
          $localize`:@@curriculum.systems.distributed-systems-i.topic.5:consensus`,
          $localize`:@@curriculum.systems.distributed-systems-i.topic.6:fault tolerance`,
        ],
      },
      {
        slug: 'systems-laboratory',
        title: $localize`:@@curriculum.systems.systems-laboratory.title:Systems Laboratory`,
        hours: 100,
        topics: [
          $localize`:@@curriculum.systems.systems-laboratory.topic.1:build a distributed key-value store: client, RPC, replication, failure, consensus`,
        ],
      },
    ],
  },
  {
    slug: 'software-distributed',
    title: $localize`:@@curriculum.module.software-distributed:Software + Distributed Computing`,
    disciplines: [
      {
        slug: 'software-engineering',
        title: $localize`:@@curriculum.software-distributed.software-engineering.title:Software Engineering`,
        hours: 60,
        topics: [
          $localize`:@@curriculum.software-distributed.software-engineering.topic.1:requirements`,
          $localize`:@@curriculum.software-distributed.software-engineering.topic.2:architecture`,
          $localize`:@@curriculum.software-distributed.software-engineering.topic.3:testing`,
          $localize`:@@curriculum.software-distributed.software-engineering.topic.4:CI/CD`,
          $localize`:@@curriculum.software-distributed.software-engineering.topic.5:observability`,
          $localize`:@@curriculum.software-distributed.software-engineering.topic.6:technical debt`,
        ],
      },
      {
        slug: 'distributed-systems-ii',
        title: $localize`:@@curriculum.software-distributed.distributed-systems-ii.title:Distributed Systems II`,
        hours: 80,
        topics: [
          $localize`:@@curriculum.software-distributed.distributed-systems-ii.topic.1:Raft`,
          $localize`:@@curriculum.software-distributed.distributed-systems-ii.topic.2:Paxos`,
          $localize`:@@curriculum.software-distributed.distributed-systems-ii.topic.3:Byzantine fault tolerance`,
          $localize`:@@curriculum.software-distributed.distributed-systems-ii.topic.4:distributed databases`,
          $localize`:@@curriculum.software-distributed.distributed-systems-ii.topic.5:eventual consistency`,
          $localize`:@@curriculum.software-distributed.distributed-systems-ii.topic.6:CRDTs`,
        ],
      },
      {
        slug: 'programming-languages',
        title: $localize`:@@curriculum.software-distributed.programming-languages.title:Programming Languages`,
        hours: 60,
        topics: [
          $localize`:@@curriculum.software-distributed.programming-languages.topic.1:interpreters`,
          $localize`:@@curriculum.software-distributed.programming-languages.topic.2:type systems`,
          $localize`:@@curriculum.software-distributed.programming-languages.topic.3:semantics`,
          $localize`:@@curriculum.software-distributed.programming-languages.topic.4:functional programming`,
          $localize`:@@curriculum.software-distributed.programming-languages.topic.5:runtime systems`,
        ],
      },
      {
        slug: 'compilers',
        title: $localize`:@@curriculum.software-distributed.compilers.title:Compilers`,
        hours: 80,
        topics: [
          $localize`:@@curriculum.software-distributed.compilers.topic.1:lexer`,
          $localize`:@@curriculum.software-distributed.compilers.topic.2:parser`,
          $localize`:@@curriculum.software-distributed.compilers.topic.3:AST`,
          $localize`:@@curriculum.software-distributed.compilers.topic.4:semantic analysis`,
          $localize`:@@curriculum.software-distributed.compilers.topic.5:IR`,
          $localize`:@@curriculum.software-distributed.compilers.topic.6:optimization`,
          $localize`:@@curriculum.software-distributed.compilers.topic.7:machine code`,
        ],
      },
      {
        slug: 'security-cryptography',
        title: $localize`:@@curriculum.software-distributed.security-cryptography.title:Security & Cryptography`,
        hours: 60,
        topics: [
          $localize`:@@curriculum.software-distributed.security-cryptography.topic.1:cryptography`,
          $localize`:@@curriculum.software-distributed.security-cryptography.topic.2:authentication`,
          $localize`:@@curriculum.software-distributed.security-cryptography.topic.3:authorization`,
          $localize`:@@curriculum.software-distributed.security-cryptography.topic.4:secure systems`,
          $localize`:@@curriculum.software-distributed.security-cryptography.topic.5:network security`,
          $localize`:@@curriculum.software-distributed.security-cryptography.topic.6:threat modeling`,
        ],
      },
      {
        slug: 'distributed-systems-laboratory',
        title: $localize`:@@curriculum.software-distributed.distributed-systems-laboratory.title:Distributed Systems Lab`,
        hours: 80,
        topics: [
          $localize`:@@curriculum.software-distributed.distributed-systems-laboratory.topic.1:build a replicated database, then break it: partition, node failure, clock skew, packet loss`,
        ],
      },
    ],
  },
  {
    slug: 'ai-theory',
    title: $localize`:@@curriculum.module.ai-theory:Intelligence + Theory`,
    disciplines: [
      {
        slug: 'artificial-intelligence',
        title: $localize`:@@curriculum.ai-theory.artificial-intelligence.title:Artificial Intelligence`,
        hours: 80,
        topics: [
          $localize`:@@curriculum.ai-theory.artificial-intelligence.topic.1:search`,
          $localize`:@@curriculum.ai-theory.artificial-intelligence.topic.2:planning`,
          $localize`:@@curriculum.ai-theory.artificial-intelligence.topic.3:knowledge representation`,
          $localize`:@@curriculum.ai-theory.artificial-intelligence.topic.4:reasoning`,
          $localize`:@@curriculum.ai-theory.artificial-intelligence.topic.5:decision making`,
          $localize`:@@curriculum.ai-theory.artificial-intelligence.topic.6:probabilistic AI`,
        ],
      },
      {
        slug: 'machine-learning',
        title: $localize`:@@curriculum.ai-theory.machine-learning.title:Machine Learning`,
        hours: 80,
        topics: [
          $localize`:@@curriculum.ai-theory.machine-learning.topic.1:probability`,
          $localize`:@@curriculum.ai-theory.machine-learning.topic.2:linear algebra`,
          $localize`:@@curriculum.ai-theory.machine-learning.topic.3:optimization`,
          $localize`:@@curriculum.ai-theory.machine-learning.topic.4:machine learning`,
          $localize`:@@curriculum.ai-theory.machine-learning.topic.5:deep learning`,
        ],
      },
      {
        slug: 'deep-learning',
        title: $localize`:@@curriculum.ai-theory.deep-learning.title:Deep Learning`,
        hours: 60,
        topics: [
          $localize`:@@curriculum.ai-theory.deep-learning.topic.1:neural networks`,
          $localize`:@@curriculum.ai-theory.deep-learning.topic.2:CNNs`,
          $localize`:@@curriculum.ai-theory.deep-learning.topic.3:RNNs`,
          $localize`:@@curriculum.ai-theory.deep-learning.topic.4:transformers`,
          $localize`:@@curriculum.ai-theory.deep-learning.topic.5:representation learning`,
          $localize`:@@curriculum.ai-theory.deep-learning.topic.6:generative models`,
        ],
      },
      {
        slug: 'information-theory',
        title: $localize`:@@curriculum.ai-theory.information-theory.title:Information Theory`,
        hours: 60,
        topics: [
          $localize`:@@curriculum.ai-theory.information-theory.topic.1:entropy`,
          $localize`:@@curriculum.ai-theory.information-theory.topic.2:information`,
          $localize`:@@curriculum.ai-theory.information-theory.topic.3:compression`,
          $localize`:@@curriculum.ai-theory.information-theory.topic.4:communication`,
          $localize`:@@curriculum.ai-theory.information-theory.topic.5:coding`,
          $localize`:@@curriculum.ai-theory.information-theory.topic.6:information limits`,
        ],
      },
      {
        slug: 'formal-methods',
        title: $localize`:@@curriculum.ai-theory.formal-methods.title:Formal Methods`,
        hours: 60,
        topics: [
          $localize`:@@curriculum.ai-theory.formal-methods.topic.1:formal specification`,
          $localize`:@@curriculum.ai-theory.formal-methods.topic.2:verification`,
          $localize`:@@curriculum.ai-theory.formal-methods.topic.3:model checking`,
          $localize`:@@curriculum.ai-theory.formal-methods.topic.4:theorem proving`,
          $localize`:@@curriculum.ai-theory.formal-methods.topic.5:program correctness`,
        ],
      },
      {
        slug: 'ai-ml-laboratory',
        title: $localize`:@@curriculum.ai-theory.ai-ml-laboratory.title:AI / ML Laboratory`,
        hours: 100,
        topics: [
          $localize`:@@curriculum.ai-theory.ai-ml-laboratory.topic.1:question`,
          $localize`:@@curriculum.ai-theory.ai-ml-laboratory.topic.2:hypothesis`,
          $localize`:@@curriculum.ai-theory.ai-ml-laboratory.topic.3:dataset`,
          $localize`:@@curriculum.ai-theory.ai-ml-laboratory.topic.4:model`,
          $localize`:@@curriculum.ai-theory.ai-ml-laboratory.topic.5:experiment`,
          $localize`:@@curriculum.ai-theory.ai-ml-laboratory.topic.6:evaluation`,
          $localize`:@@curriculum.ai-theory.ai-ml-laboratory.topic.7:reproduce`,
          $localize`:@@curriculum.ai-theory.ai-ml-laboratory.topic.8:challenge`,
        ],
      },
    ],
  },
  {
    slug: 'specialization',
    title: $localize`:@@curriculum.module.specialization:Specialization`,
    tracks: [
      {
        slug: 'track-a-systems',
        title: $localize`:@@curriculum.specialization.track-a-systems.title:Track A — Systems`,
        disciplines: [
          {
            slug: 'systems',
            title: $localize`:@@curriculum.specialization.track-a-systems.systems.title:Systems depth`,
            topics: [
              $localize`:@@curriculum.specialization.track-a-systems.systems.topic.1:advanced OS`,
              $localize`:@@curriculum.specialization.track-a-systems.systems.topic.2:distributed systems`,
              $localize`:@@curriculum.specialization.track-a-systems.systems.topic.3:databases`,
              $localize`:@@curriculum.specialization.track-a-systems.systems.topic.4:cloud computing`,
              $localize`:@@curriculum.specialization.track-a-systems.systems.topic.5:high performance computing`,
              $localize`:@@curriculum.specialization.track-a-systems.systems.topic.6:computer architecture`,
            ],
          },
        ],
      },
      {
        slug: 'track-b-ai',
        title: $localize`:@@curriculum.specialization.track-b-ai.title:Track B — AI`,
        disciplines: [
          {
            slug: 'ai',
            title: $localize`:@@curriculum.specialization.track-b-ai.ai.title:AI depth`,
            topics: [
              $localize`:@@curriculum.specialization.track-b-ai.ai.topic.1:advanced machine learning`,
              $localize`:@@curriculum.specialization.track-b-ai.ai.topic.2:deep learning`,
              $localize`:@@curriculum.specialization.track-b-ai.ai.topic.3:computer vision`,
              $localize`:@@curriculum.specialization.track-b-ai.ai.topic.4:NLP`,
              $localize`:@@curriculum.specialization.track-b-ai.ai.topic.5:reinforcement learning`,
              $localize`:@@curriculum.specialization.track-b-ai.ai.topic.6:generative AI`,
            ],
          },
        ],
      },
      {
        slug: 'track-c-theory',
        title: $localize`:@@curriculum.specialization.track-c-theory.title:Track C — Theory`,
        disciplines: [
          {
            slug: 'theory',
            title: $localize`:@@curriculum.specialization.track-c-theory.theory.title:Theory depth`,
            topics: [
              $localize`:@@curriculum.specialization.track-c-theory.theory.topic.1:advanced algorithms`,
              $localize`:@@curriculum.specialization.track-c-theory.theory.topic.2:complexity`,
              $localize`:@@curriculum.specialization.track-c-theory.theory.topic.3:cryptography`,
              $localize`:@@curriculum.specialization.track-c-theory.theory.topic.4:information theory`,
              $localize`:@@curriculum.specialization.track-c-theory.theory.topic.5:formal methods`,
              $localize`:@@curriculum.specialization.track-c-theory.theory.topic.6:computational geometry`,
            ],
          },
        ],
      },
      {
        slug: 'track-d-software',
        title: $localize`:@@curriculum.specialization.track-d-software.title:Track D — Software`,
        disciplines: [
          {
            slug: 'software',
            title: $localize`:@@curriculum.specialization.track-d-software.software.title:Software depth`,
            topics: [
              $localize`:@@curriculum.specialization.track-d-software.software.topic.1:programming languages`,
              $localize`:@@curriculum.specialization.track-d-software.software.topic.2:compilers`,
              $localize`:@@curriculum.specialization.track-d-software.software.topic.3:type systems`,
              $localize`:@@curriculum.specialization.track-d-software.software.topic.4:program analysis`,
              $localize`:@@curriculum.specialization.track-d-software.software.topic.5:software verification`,
              $localize`:@@curriculum.specialization.track-d-software.software.topic.6:developer tools`,
            ],
          },
        ],
      },
      {
        slug: 'track-e-human-computing',
        title: $localize`:@@curriculum.specialization.track-e-human-computing.title:Track E — Human Computing`,
        disciplines: [
          {
            slug: 'human-computing',
            title: $localize`:@@curriculum.specialization.track-e-human-computing.human-computing.title:Human computing depth`,
            topics: [
              $localize`:@@curriculum.specialization.track-e-human-computing.human-computing.topic.1:HCI`,
              $localize`:@@curriculum.specialization.track-e-human-computing.human-computing.topic.2:graphics`,
              $localize`:@@curriculum.specialization.track-e-human-computing.human-computing.topic.3:visualization`,
              $localize`:@@curriculum.specialization.track-e-human-computing.human-computing.topic.4:computer vision`,
              $localize`:@@curriculum.specialization.track-e-human-computing.human-computing.topic.5:interaction`,
            ],
          },
        ],
      },
      {
        slug: 'track-f-robotics',
        title: $localize`:@@curriculum.specialization.track-f-robotics.title:Track F — Robotics`,
        disciplines: [
          {
            slug: 'robotics',
            title: $localize`:@@curriculum.specialization.track-f-robotics.robotics.title:Robotics depth`,
            topics: [
              $localize`:@@curriculum.specialization.track-f-robotics.robotics.topic.1:robotics`,
              $localize`:@@curriculum.specialization.track-f-robotics.robotics.topic.2:control`,
              $localize`:@@curriculum.specialization.track-f-robotics.robotics.topic.3:computer vision`,
              $localize`:@@curriculum.specialization.track-f-robotics.robotics.topic.4:planning`,
              $localize`:@@curriculum.specialization.track-f-robotics.robotics.topic.5:robot learning`,
              $localize`:@@curriculum.specialization.track-f-robotics.robotics.topic.6:autonomous systems`,
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'research',
    title: $localize`:@@curriculum.module.research:Research & Independent Computing`,
    disciplines: [
      {
        slug: 'independent-research',
        title: $localize`:@@curriculum.research.independent-research.title:Independent Research`,
        topics: [
          $localize`:@@curriculum.research.independent-research.topic.1:question`,
          $localize`:@@curriculum.research.independent-research.topic.2:literature`,
          $localize`:@@curriculum.research.independent-research.topic.3:papers`,
          $localize`:@@curriculum.research.independent-research.topic.4:hypothesis`,
          $localize`:@@curriculum.research.independent-research.topic.5:implementation`,
          $localize`:@@curriculum.research.independent-research.topic.6:experiment`,
          $localize`:@@curriculum.research.independent-research.topic.7:result`,
          $localize`:@@curriculum.research.independent-research.topic.8:reflection`,
          $localize`:@@curriculum.research.independent-research.topic.9:new question`,
        ],
      },
    ],
  },
];
