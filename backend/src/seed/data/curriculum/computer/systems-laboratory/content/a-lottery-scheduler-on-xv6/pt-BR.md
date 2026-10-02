---
version: 1.0
updatedAt: 2026-09-12
title: "Laboratório: um Escalonador por Loteria no xv6"
summary: "Este laboratório, que corresponde ao trabalho oficial de escalonamento do xv6 nos OSTEP-projects, substitui o escalonador round-robin padrão do próprio xv6 por um escalonador por loteria, atribuindo a cada processo um número de bilhetes e escolhendo o próximo processo a rodar por um sorteio aleatório ponderado. É um mecanismo de justiça genuinamente diferente da abordagem de ajuste de prioridade do Escalonamento com Filas Multinível com Realimentação, e que contorna por construção o modo de falha de inanição de Escalonamento por Prioridade e Inanição, já que todo processo com pelo menos um bilhete tem uma chance real, diferente de zero, de ser sorteado em toda decisão de escalonamento."
---
## Objetivos de Aprendizagem

- Substituir o escalonador round-robin padrão do xv6 por um escalonador por loteria que atribui a cada processo um número de bilhetes e escolhe o próximo processo por um sorteio aleatório ponderado.
- Implementar uma nova chamada de sistema que permite a um processo definir sua própria quantidade de bilhetes, e uma quantidade padrão sensata de bilhetes para processos que nunca a chamam.
- Explicar por que o escalonamento por loteria evita a inanição por construção, e ligar essa garantia ao modo de falha teórico que `priority-scheduling-and-starvation` já descreve.
- Medir, de forma empírica, se a fatia de CPU de fato observada de um processo numa execução real bate com sua fatia de bilhetes do total, dentro da aleatoriedade que o próprio mecanismo introduz.

## Contexto e Motivação

Os conceitos **Escalonamento com Filas Multinível com Realimentação** e **Escalonamento por Prioridade e Inanição** de `operating-systems-i` cobrem duas abordagens reais e diferentes para o escalonamento justo de CPU: uma ajusta a prioridade dinamicamente com base no comportamento observado, a outra atribui prioridades fixas, com um risco real de deixar processos de baixa prioridade em inanição indefinidamente. Este laboratório, que corresponde ao trabalho oficial de escalonamento do xv6 nos OSTEP-projects, implementa um terceiro mecanismo, genuinamente diferente, dentro de um kernel real e funcional: o escalonamento por loteria, em que a justiça vem da probabilidade, e não da contabilidade do histórico de cada processo.

## Teoria Central

Nada sobre *por que* a MLFQ ajusta a prioridade com base no comportamento observado, ou *por que* o escalonamento de prioridade fixa pode deixar um processo em inanição indefinidamente, é rederivado aqui; os dois argumentos já existem em `multi-level-feedback-queue-scheduling` e `priority-scheduling-and-starvation` deste currículo. Este laboratório implementa um projeto totalmente diferente: todo processo executável guarda um certo número de bilhetes, e o escalonador escolhe seu próximo processo sorteando um número aleatório e encontrando em qual faixa de bilhetes de processo esse número cai, exatamente a especificação do próprio trabalho de loteria do xv6 nos OSTEP-projects.

## Exemplos Resolvidos

### Especificação da API

```text
int settickets(int number);  // nova syscall: define a quantidade de bilhetes do
                                // próprio processo chamador; devolve 0 em caso de sucesso

Quantidade padrão de bilhetes para um processo que nunca chama settickets: 1
(conforme o padrão declarado pelo próprio trabalho dos OSTEP-projects)
```

### Passo 1: acrescentando uma quantidade de bilhetes à estrutura de processo do xv6

```c
// kernel/proc.h
struct proc {
  // ... campos existentes do xv6 (pid, state, trapframe etc.) inalterados ...
  int tickets;   // NOVO: a quantidade de bilhetes deste processo
};
```

```c
// kernel/proc.c, em allocproc(): todo processo NOVO começa com o
// padrão documentado antes de rodar pela primeira vez
p->tickets = 1;
```

### Passo 2: a nova chamada de sistema

```c
uint64
sys_settickets(void)
{
  int n;
  argint(0, &n);
  if (n < 1) {
    return -1;  // um processo não pode ter zero bilhetes nem uma quantidade negativa
  }
  myproc()->tickets = n;
  return 0;
}
```

### Passo 3: substituindo o laço do escalonador round-robin do xv6 por um sorteio ponderado

```c
// kernel/proc.c, scheduler(): a versão padrão do xv6 percorre a tabela de
// processos numa ordem fixa, escolhendo o próximo processo RUNNABLE da vez;
// este laboratório SUBSTITUI esse percurso por um sorteio aleatório ponderado

void
scheduler(void)
{
  struct cpu *c = mycpu();
  for(;;){
    intr_on();

    int total_tickets = 0;
    for(struct proc *p = proc; p < &proc[NPROC]; p++) {
      if(p->state == RUNNABLE) total_tickets += p->tickets;
    }
    if (total_tickets == 0) continue;  // nada executável; gira

    int winner = random_int() % total_tickets;  // o "sorteio da loteria"
    int counter = 0;
    for(struct proc *p = proc; p < &proc[NPROC]; p++) {
      if(p->state != RUNNABLE) continue;
      counter += p->tickets;
      if (counter > winner) {
        // a FAIXA de bilhetes deste processo contém o número sorteado:
        // ele roda em seguida
        acquire(&p->lock);
        p->state = RUNNING;
        c->proc = p;
        swtch(&c->context, &p->context);
        c->proc = 0;
        release(&p->lock);
        break;
      }
    }
  }
}
```

Um processo com o dobro de bilhetes de outro ocupa uma faixa duas vezes mais larga dentro de `total_tickets`, então é sorteado, em média, duas vezes mais vezes, sem histórico por processo, sem contabilidade de nível de fila e sem precisar de nenhum mecanismo explícito de envelhecimento para alcançar essa justiça proporcional.

### Passo 4: por que isso evita a inanição por construção, e medindo isso diretamente

```text
Qualquer processo com tickets >= 1 tem uma probabilidade DIFERENTE DE ZERO de ser
sorteado em TODA decisão de escalonamento, não importa quantos outros processos
estejam executáveis nem há quanto tempo ele já espera; essa é a diferença
estrutural em relação ao escalonamento de prioridade fixa, em que um processo de
prioridade mais baixa pode ficar em inanição indefinidamente por um fluxo contínuo
de processos de prioridade mais alta, exatamente o modo de falha que
priority-scheduling-and-starvation descreve.
```

```c
// Um programa de teste em espaço de usuário: três processos filhos chamam
// settickets(1), settickets(2) e settickets(3), respectivamente, e então cada
// um gira, incrementando seu próprio contador, por uma duração fixa de tempo real.
// Medidas numa execução longa o bastante, as contagens devem cair perto da
// proporção 1:2:3 que os bilhetes especificam, mas NÃO exatamente, já que o
// sorteio é genuinamente aleatório a cada decisão de escalonamento, e não
// determinístico.
```

## Equívocos Comuns e Armadilhas

- **"Um processo com mais bilhetes tem garantia de rodar antes de um processo com menos bilhetes, em qualquer sorteio."** O sorteio é genuinamente probabilístico: um processo com poucos bilhetes ainda pode vencer qualquer loteria individual, só que com probabilidade menor; a justiça que o escalonamento por loteria oferece é uma garantia estatística ao longo de muitas decisões de escalonamento, e não uma ordem determinística.
- **"O escalonamento por loteria precisa acompanhar há quanto tempo cada processo está esperando, parecido com o mecanismo de impulso de prioridade da própria MLFQ."** Ele não precisa de contabilidade nenhuma desse tipo; a propriedade de probabilidade diferente de zero em todo sorteio, que evita a inanição, sai diretamente do próprio mecanismo de faixas de bilhetes, e é precisamente isso que torna este projeto mais simples de implementar que a lógica de várias filas e ajuste de prioridade da própria MLFQ.
- **"Testar este escalonador significa conferir que as fatias de CPU observadas batem exatamente com as proporções de bilhetes."** Com um sorteio genuinamente aleatório a cada decisão, a correspondência exata não é a expectativa certa; o teste do Passo 4 confere que as fatias medidas caem *perto* da proporção especificada numa execução longa o bastante, e a variância que sobra é uma propriedade esperada e correta do mecanismo, e não um bug.

## Resumo

Este laboratório substitui o escalonador round-robin padrão do xv6 por um escalonador por loteria, correspondendo ao trabalho oficial de escalonamento do xv6 nos OSTEP-projects: cada processo guarda uma quantidade de bilhetes (definível por uma nova syscall, com padrão 1), e o escalonador escolhe seu próximo processo por um sorteio aleatório ponderado sobre as faixas de bilhetes de todos os processos executáveis, dando aos processos uma fatia de CPU proporcional aos seus bilhetes, sem histórico por processo nem contabilidade de nível de fila. O escalonamento por loteria evita por construção o modo de falha de inanição de `priority-scheduling-and-starvation`, já que qualquer processo com pelo menos um bilhete tem probabilidade diferente de zero de vencer qualquer sorteio; uma garantia de justiça estruturalmente diferente do ajuste de prioridade baseado em histórico de `multi-level-feedback-queue-scheduling`.

## Documentation Links

- [OSTEP Projects: xv6 Kernel Projects (Scheduling)](https://github.com/remzi-arpacidusseau/ostep-projects): o trabalho real e oficial ao qual a implementação do escalonador por loteria deste laboratório corresponde, incluindo sua API exata e a especificação da quantidade padrão de bilhetes.
- [Arpaci-Dusseau: Operating Systems: Three Easy Pieces, "Scheduling: The Multi-Level Feedback Queue"](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched-mlfq.pdf): a fonte do projeto de escalonamento baseado em prioridade, contrastante, do qual o mecanismo de loteria deste laboratório é construído de propósito de forma diferente.
