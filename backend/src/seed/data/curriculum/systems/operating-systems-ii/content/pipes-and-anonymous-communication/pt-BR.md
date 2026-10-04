---
version: 1.0
updatedAt: 2026-09-06
title: "Pipes e Comunicação Anônima"
summary: "O operador | do shell conecta a saída padrão de um processo diretamente à entrada padrão de outro por meio de um buffer de bytes gerenciado pelo kernel: a forma de IPC mais simples, mais antiga e ainda mais comum em qualquer sistema tipo Unix."
---
## Objetivos de Aprendizagem

- Definir um pipe como um fluxo de bytes unidirecional, gerenciado pelo kernel, conectando a saída de um processo à entrada de outro, sem nenhuma memória compartilhada visível a qualquer um dos processos.
- Explicar como o operador `|` do shell usa `pipe()`, `fork()` e manipulação de descritores de arquivo para conectar em tempo de execução dois programas que de resto não têm relação.
- Descrever o buffer de kernel de tamanho fixo do pipe e o que acontece quando um escritor o enche ou um leitor o esvazia (comportamento bloqueante).
- Distinguir um pipe (anônimo, utilizável apenas entre processos aparentados) dos conceitos seguintes deste bloco que relaxam uma ou ambas essas restrições.

## Contexto e Motivação

Todo conceito até agora nesta disciplina (traps, chamadas de sistema, validação de entrada) tratou da relação de um único processo com o kernel. Mas sistemas reais são construídos a partir de muitos processos cooperando, e cooperação exige comunicação: a saída de um programa precisa se tornar a entrada de outro, um servidor web precisa entregar uma requisição a um processo trabalhador, as passagens separadas de um compilador precisam trocar dados intermediários. `operating-systems-i` deu a cada processo um espaço de endereçamento isolado justamente para que os bugs de um processo não possam corromper a memória de outro, mas esse mesmo isolamento significa que dois processos não têm, por padrão, absolutamente nenhuma forma de trocar dados. A comunicação entre processos (IPC) é o conjunto deliberado de mecanismos mediados pelo kernel que permite a processos isolados se comunicarem mesmo assim, com segurança, apenas quando e como escolhem explicitamente.

O pipe é o mecanismo de IPC mais antigo, mais simples e ainda mais usado em qualquer sistema tipo Unix, visível toda vez que um usuário encadeia comandos com `|` num prompt de shell. Entendê-lo com precisão, incluindo as suas limitações reais, prepara o restante deste bloco: cada mecanismo de IPC seguinte relaxa exatamente uma restrição que um pipe impõe, em troca de algum custo ou complexidade adicional.

## Teoria Central

### O que um pipe de fato é: um buffer do kernel com dois descritores de arquivo

Um pipe, da perspectiva do kernel, é um buffer de bytes circular, de tamanho fixo, dentro do kernel, com exatamente duas extremidades: uma extremidade de leitura e uma extremidade de escrita, cada uma exposta aos processos de espaço de usuário como um descritor de arquivo comum. Crucialmente, os dados no buffer de um pipe nunca são mapeados no próprio espaço de endereçamento de qualquer um dos processos, como a memória compartilhada (o próximo conceito) será: um processo escrevendo num pipe entrega os seus bytes ao kernel via a chamada de sistema comum `write()`, e um processo lendo de um pipe recebe bytes do kernel via o `read()` comum, exatamente as mesmas chamadas de sistema já usadas para arquivos, com o kernel fazendo o transporte de bytes de fato no meio. É precisamente por isso que um pipe não exige nada de novo no nível das chamadas de sistema: ele reusa exatamente a interface `read`/`write` que `operating-systems-i` já estabeleceu, aplicada a um tipo especial de descritor de arquivo em vez de um arquivo de disco comum.

### Montando um pipe entre dois processos: `pipe()` antes de `fork()`

Como os dois descritores de arquivo de um pipe só significam algo para processos que já os têm abertos, conectar dois programas *separados* exige uma sequência específica e bem definida: um único processo chama `pipe()`, que pede ao kernel para criar um novo pipe e retorna dois descritores de arquivo (convencionalmente, o índice 0 para a extremidade de leitura e o índice 1 para a de escrita) na tabela de descritores de arquivo desse mesmo processo. Esse processo então chama `fork()` e, como um filho criado por fork herda uma cópia da tabela de descritores de arquivo inteira do pai, tanto o pai quanto o filho agora seguram descritores que se referem ao mesmíssimo objeto pipe do kernel. A partir daí, um lado fecha a sua cópia da extremidade de leitura e mantém só a de escrita; o outro fecha a sua cópia da extremidade de escrita e mantém só a de leitura, e os dois processos, que podem não ter mais nada em comum, agora têm um canal de comunicação unidirecional funcionando.

```mermaid
flowchart LR
    subgraph Before fork
        P["Processo pai\nchama pipe()\nfd[0]=leitura, fd[1]=escrita"]
    end
    P -->|fork| C1["Pai depois do fork\nmantém fd[1] (escrita)\nfecha fd[0]"]
    P -->|fork| C2["Filho depois do fork\nmantém fd[0] (leitura)\nfecha fd[1]"]
    C1 -->|write(fd1, ...)| K["Buffer de pipe do kernel\n(tamanho fixo, FIFO)"]
    K -->|read(fd0, ...)| C2
```

### O operador `|` do shell: exatamente este mecanismo, automatizado

Quando um usuário digita `ls | wc -l` num prompt de shell, o shell realiza precisamente a sequência acima em nome do usuário: ele chama `pipe()` uma vez, depois faz `fork()` duas vezes (uma por comando), e em cada filho usa `dup2()` para fazer a extremidade apropriada do pipe assumir o descritor de arquivo 0 ou 1 (entrada padrão ou saída padrão) antes de chamar `exec()` para de fato rodar `ls` ou `wc`. Nem `ls` nem `wc` precisam saber nada sobre pipes: cada um simplesmente lê da sua entrada padrão ou escreve na sua saída padrão, exatamente como sempre faz, sem saber que o seu descritor padrão foi silenciosamente religado para apontar para o outro programa em vez do terminal.

### Comportamento bloqueante: o que acontece nos limites do buffer

O buffer de kernel de um pipe tem uma capacidade fixa e finita (comumente uns poucos kilobytes em sistemas reais). Se um escritor produz dados mais rápido do que um leitor os consome, o buffer eventualmente enche, e o kernel faz a chamada `write()` do escritor bloquear: o processo escritor é desescalonado (usando o mesmo mecanismo de bloqueio no qual as variáveis de condição de `operating-systems-i` se apoiam internamente) até que o leitor esvazie espaço suficiente para aceitar mais. Simetricamente, se um leitor tenta ler de um pipe vazio cuja extremidade de escrita ainda está aberta, a sua chamada `read()` bloqueia até que dados cheguem. Se a extremidade de escrita está fechada e o buffer está vazio, `read()` em vez disso retorna imediatamente, sinalizando fim de arquivo, precisamente o mecanismo que permite a `wc -l` saber que a saída de `ls` genuinamente terminou, e não apenas pausou.

### A limitação real que os próximos conceitos deste bloco relaxam

Um pipe é deliberadamente restritivo de duas formas específicas: ele é *anônimo*, o que significa que só processos que já compartilham um ancestral comum (e portanto herdaram o mesmo descritor de arquivo via `fork()`) podem usá-lo (não há forma de dois processos arbitrários e sem relação descobrirem e se conectarem ao mesmo pipe depois do fato), e ele é um *fluxo de bytes*, sem nenhuma noção embutida de fronteiras de mensagem; um leitor não tem como saber onde a "mensagem" lógica de um escritor termina e a próxima começa, só a partir do próprio mecanismo do pipe. As duas limitações motivam os mecanismos que este bloco cobre a seguir.

## Exemplos Resolvidos

### Exemplo 1: Implementando `ls | wc -l` à mão em C

```c
int fd[2];
pipe(fd);                          // fd[0] = extremidade de leitura, fd[1] = de escrita

if (fork() == 0) {                 // filho: roda "ls"
    close(fd[0]);                  // não precisa da extremidade de leitura
    dup2(fd[1], STDOUT_FILENO);    // o stdout de ls agora É a extremidade de escrita do pipe
    close(fd[1]);
    execlp("ls", "ls", NULL);
}

if (fork() == 0) {                 // segundo filho: roda "wc -l"
    close(fd[1]);                  // não precisa da extremidade de escrita
    dup2(fd[0], STDIN_FILENO);     // o stdin de wc agora É a extremidade de leitura do pipe
    close(fd[0]);
    execlp("wc", "wc", "-l", NULL);
}

close(fd[0]); close(fd[1]);        // o pai não precisa de nenhuma das extremidades
wait(NULL); wait(NULL);
```

Nem `ls` nem `wc` foram escritos com qualquer consciência de pipes: o redirecionamento acontece inteiramente por manipulação de descritores de arquivo antes que `exec()` substitua a imagem de memória de cada filho.

### Exemplo 2: Um rastro concreto de bloqueio

```text
Capacidade do buffer do pipe: 64 KB (ilustrativo)

Escritor produz dados mais rápido do que o leitor consome:
  t=0    Escritor escreve 64 KB.  Buffer: cheio.
  t=1    Escritor tenta escrever mais 1 byte -> BLOQUEIA.
  t=2    Leitor lê 10 KB.         Buffer: 54 KB ocupados, 10 KB livres.
  t=3    O write() bloqueado do escritor desbloqueia, escreve até 10 KB,
         e depois bloqueia de novo se ainda tiver mais para enviar.

Leitor encontra um buffer vazio, extremidade de escrita ainda aberta:
  O read() do leitor BLOQUEIA até chegarem mais dados ou o pipe fechar.

Leitor encontra um buffer vazio, extremidade de escrita agora fechada:
  O read() do leitor retorna 0 imediatamente (fim de arquivo), sem bloquear.
```

### Exemplo 3: Por que um pipe anônimo não consegue conectar dois processos sem relação, já em execução

```text
Processo A (PID 501, iniciado há uma hora, sem ancestral comum com B)
Processo B (PID 830, iniciado agora mesmo por outro usuário)

Nenhum dos processos jamais chamou fork() com o outro como pai/filho,
então nenhum herdou um descritor de arquivo de pipe compartilhado de um
ancestral comum. Não existe uma chamada `pipe()` que possa conectá-los
retroativamente -- os descritores de arquivo que um pipe retorna só têm
significado dentro do processo (e dos seus descendentes via fork()) que
os criou.
```

Esta é exatamente a lacuna que filas de mensagens e sockets (mais adiante neste bloco) são projetados para fechar, cada um de uma forma diferente.

## Equívocos Comuns e Armadilhas

- **"Um pipe copia dados diretamente da memória de um processo para a de outro."** O kernel media cada byte por meio do seu próprio buffer interno via chamadas de sistema comuns `read`/`write`; em nenhum momento a memória de qualquer um dos processos é diretamente visível ao outro, ao contrário do mecanismo de memória compartilhada coberto a seguir.
- **"Quaisquer dois processos do sistema podem se comunicar via um pipe se ambos souberem o número do seu descritor de arquivo."** Os descritores de arquivo de um pipe só têm significado dentro do processo que o criou e de quaisquer descendentes que os herdaram via `fork()`. Não há forma de um processo sem relação se conectar a um pipe anônimo existente depois do fato.
- **"Um pipe tem capacidade ilimitada; um escritor rápido sempre consegue se adiantar a um leitor lento."** O buffer de pipe do kernel tem um tamanho fixo e finito; uma vez cheio, a chamada `write()` do escritor bloqueia até que o leitor abra espaço, que é precisamente o mecanismo de contrapressão que impede um produtor rápido de sobrecarregar a memória de um consumidor lento.
- **"`read()` retornando 0 de um pipe significa que ocorreu um erro."** Isso sinaliza fim de arquivo (a extremidade de escrita foi fechada e o buffer está vazio), que é a forma normal e esperada de um leitor saber que não virão mais dados.

## Resumo

Um pipe é um buffer de fluxo de bytes unidirecional, de capacidade fixa e gerenciado pelo kernel, exposto aos processos de usuário como um par comum de descritores de arquivo e manipulado com as mesmas chamadas de sistema `read`/`write` já usadas para arquivos. Conectar dois programas separados, como o operador `|` do shell faz automaticamente, exige chamar `pipe()` antes de `fork()`, para que os dois processos resultantes herdem descritores que se referem ao mesmo objeto subjacente do kernel, e depois fechar a extremidade não usada em cada lado. O tamanho fixo do buffer do kernel dá aos pipes um mecanismo de controle de fluxo natural e embutido: um buffer cheio bloqueia o escritor, um vazio (com a extremidade de escrita ainda aberta) bloqueia o leitor, e uma extremidade de escrita fechada sinaliza fim de arquivo. As duas limitações reais de um pipe (ele só conecta processos com um ancestral comum, e carrega um fluxo de bytes indiferenciado sem fronteiras de mensagem) são exatamente o que a memória compartilhada, as filas de mensagens e os sockets, cobertos a seguir neste bloco, relaxam cada um de uma forma diferente.

## Documentation Links

- [UC Berkeley CS162: Course Schedule](https://cs162.org/): cobre pipes e sockets como os mecanismos de IPC a partir dos quais este bloco constrói.
- [MIT 6.S081: Lab: Unix Utilities](https://pdos.csail.mit.edu/6.S081/2021/labs/util.html): a tarefa real que implementa um utilitário de shell baseado em pipes no xv6.
