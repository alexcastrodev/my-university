---
version: 1.0
updatedAt: 2026-09-12
title: "Projeto Final: Acompanhando um Processo, de Verdade"
summary: "O conceito de fechamento de Sistemas Operacionais I acompanha um processo por fork, escalonamento, uma falta de página e uma escrita em disco como uma única narrativa conectada; este projeto final é onde essa narrativa roda de verdade, contra os componentes reais que esta disciplina inteira construiu: um processo criado e recebendo bilhetes do escalonador por loteria do Laboratório 9, um acesso à memória que falta no TLB simulado do Laboratório 10 e percorre sua tabela de páginas, e uma escrita resultante gravada pelo próprio sistema de arquivos simples do Laboratório 11, com cada um desses quatro eventos registrado com marca de tempo e produzido como um único traço contínuo que liga os laboratórios construídos separadamente desta disciplina no sistema integrado que Sistemas Operacionais I só teve espaço para descrever em prosa."
---
## Objetivos de Aprendizagem

- Ligar o ciclo de vida de um processo real (criado, escalonado, dando falta, escrevendo em disco) aos componentes específicos que os laboratórios dos Arcos 3 e 4 desta disciplina construíram separadamente.
- Produzir um único traço contínuo e com marcas de tempo que abrange uma decisão de escalonamento (Laboratório 9), uma falta na tabela de páginas (Laboratório 10) e uma escrita no sistema de arquivos (Laboratório 11), a partir de um único cenário conectado, e não de três testes isolados.
- Comparar diretamente essa narrativa acompanhada e conectada com o próprio conceito final de `operating-systems-i`, confirmando que a mesma história se sustenta quando os componentes subjacentes são código real e funcional, e não prosa.
- Identificar, a partir do traço, qual componente específico foi responsável por cada evento observável, e explicar por que essa atribuição só é possível porque os três componentes foram construídos e instrumentados de forma consistente nesta disciplina.

## Contexto e Motivação

O próprio conceito de fechamento de `operating-systems-i`, **Projeto Final: Acompanhando um Processo do fork() à Falta de Página e ao Disco**, conta uma história conectada: um processo é criado, o escalonador acaba lhe dando tempo de CPU, ele toca um endereço de memória ainda não mapeado e dá falta, o kernel resolve essa falta buscando ou alocando uma página e, em algum momento, o processo escreve dados que acabam chegando ao disco pelo sistema de arquivos. O projeto final desta disciplina é onde essa história roda de verdade, contra o escalonador por loteria real (Laboratório 9), o simulador real de tabela de páginas e TLB (Laboratório 10) e o sistema de arquivos real (Laboratório 11) que esta disciplina construiu separadamente, ligando-os no sistema integrado que `operating-systems-i` só teve espaço para descrever em prosa.

## Teoria Central

Nada sobre *por que* cada evento individual (uma decisão de escalonamento, uma falta de página, uma escrita em disco) acontece é rederivado aqui; cada um já tem seu próprio tratamento teórico em `operating-systems-i` e sua própria implementação funcional nos laboratórios anteriores desta disciplina. O conteúdo real deste projeto final é a integração: tornar os três componentes construídos separadamente observáveis por um único formato de traço compartilhado e consistente, e rodar um único cenário conectado que exercita os três na ordem que o projeto final teórico descreve.

## Exemplos Resolvidos

### O cenário conectado

```text
1. Um processo simulado é criado e recebe 3 bilhetes (o escalonador por
   loteria do Laboratório 9); outros dois processos com 1 bilhete cada já
   estão rodando.
2. O processo acaba sendo sorteado pela loteria do escalonador.
3. Já rodando, ele acessa um endereço virtual cuja página ainda não está
   residente (o simulador de tabela de páginas do Laboratório 10 informa
   uma falta de página).
4. O tratador de faltas aloca um quadro físico (despejando uma página
   existente pela política LRU do Laboratório 10, já que os quadros físicos
   são escassos neste cenário) e mapeia a nova página.
5. O processo escreve dados, que o sistema de arquivos do Laboratório 11
   persiste: um bloco livre é alocado, os dados são escritos e o inode do
   arquivo do processo é atualizado para apontar para ele.
```

### Passo 1: um formato de traço compartilhado e com marcas de tempo para os três componentes

```python
class Trace:
    def __init__(self):
        self.events = []

    def log(self, component: str, event: str, detail: dict):
        self.events.append({
            "t": simulated_clock(),
            "component": component,  # "scheduler" | "vm" | "fs"
            "event": event,
            "detail": detail,
        })
```

O código de cada laboratório anterior recebe exatamente uma chamada adicional, `trace.log(...)`, inserida no ponto específico em que produz um evento que vale registrar; nenhuma outra lógica dos Laboratórios 9, 10 ou 11 muda, e isso é deliberado: este projeto final é sobre observar juntos os componentes existentes, já corretos, e não modificar o que eles fazem.

### Passo 2: instrumentando cada componente no seu único evento significativo

```python
# No escalonador do Laboratório 9, no momento em que um processo vence o sorteio da loteria:
trace.log("scheduler", "process_scheduled", {"pid": winner.pid, "tickets": winner.tickets})

# No simulador de tabela de páginas do Laboratório 10, dentro de _handle_page_fault:
trace.log("vm", "page_fault", {"vpn": vpn, "evicted_vpn": victim_vpn if victim_vpn else None})

# No sistema de arquivos do Laboratório 11, dentro de fs_write, logo depois da atualização do inode:
trace.log("fs", "block_written", {"inode": inum, "block": block_num, "bytes": len(data)})
```

### Passo 3: rodando o cenário conectado e produzindo um único traço

```python
def test_capstone_connected_trace():
    trace = Trace()
    scheduler = LotteryScheduler(trace=trace)
    vm = PageTableSimulator(frames=4, policy="LRU", trace=trace)
    fs = FileSystem(disk_path="capstone_disk.img", trace=trace)

    proc = scheduler.create_process(tickets=3)
    scheduler.run_until(proc, "scheduled")

    vm.translate(proc.some_unmapped_address)   # força a falta de página
    fs.fs_write(proc.inode, data=b"hello, capstone")

    assert [e["event"] for e in trace.events] == \
        ["process_scheduled", "page_fault", "block_written"], \
        "o traço deve mostrar os eventos dos três componentes, na ordem em que aconteceram"
```

### Passo 4: lendo o traço pronto como uma única história conectada

```text
t=0.012s  [scheduler]  process_scheduled   {pid: 7, tickets: 3}
t=0.014s  [vm]         page_fault          {vpn: 1024, evicted_vpn: 512}
t=0.019s  [fs]         block_written        {inode: 3, block: 88, bytes: 15}
```

Essa é a própria narrativa de fechamento de `operating-systems-i`, contada aqui não como prosa, mas como três eventos com marca de tempo e atribuíveis, cada um rastreável até o componente exato e a linha exata de código do laboratório exato (o escalonador do Laboratório 9, o tratador de faltas do Laboratório 10, o caminho de escrita do Laboratório 11) que o produziu; o que só é possível porque os três foram construídos com uma interface consistente o bastante, nesta mesma disciplina, para serem ligados num único traço compartilhado.

## Equívocos Comuns e Armadilhas

- **"Rodar as próprias suítes de teste individuais dos Laboratórios 9, 10 e 11 já demonstra que o sistema completo funciona."** Os testes de cada laboratório anterior verificam aquele componente isoladamente; nada nesses testes confirma que os três de fato se compõem corretamente num único cenário conectado, e é exatamente isso que o teste de traço compartilhado deste projeto final confere, e o que o próprio conceito final de `operating-systems-i` descreve como uma história contínua, e não como três histórias separadas.
- **"Acrescentar chamadas de traço a código já correto arrisca introduzir bugs novos."** A instrumentação do Passo 2 é deliberadamente mínima (uma chamada `trace.log()` inserida num ponto já existente e já correto da lógica de cada componente, sem nenhuma mudança no comportamento real dessa lógica), e é precisamente por isso que é seguro acrescentá-la depois que cada componente já foi verificado de forma independente no seu próprio laboratório.
- **"A ordem em que os eventos aparecem no traço não importa muito, desde que os três aconteçam em algum momento."** A asserção do Passo 3 confere especificamente a ordem exata porque a própria narrativa do projeto final de `operating-systems-i` é uma sequência causal: escalonamento antes da falta (o processo precisa estar rodando para tocar a memória), a falta antes da escrita (a página precisa estar mapeada antes que dados possam ser escritos por ela); um traço mostrando os eventos fora dessa ordem revelaria um bug real em como os componentes estão de fato sequenciados, e não um problema cosmético.

## Resumo

Este projeto final liga os três componentes construídos separadamente nos Arcos 3 e 4 (o escalonador por loteria do Laboratório 9, o simulador de tabela de páginas e TLB do Laboratório 10 e o sistema de arquivos do Laboratório 11) num único cenário em execução e num único traço compartilhado e com marcas de tempo, transformando a própria narrativa de fechamento de `operating-systems-i` (um processo escalonado, dando falta e acabando por escrever em disco) de prosa numa sequência observada e atribuível de eventos reais. Cada evento acompanhado é diretamente rastreável até o componente exato, e o laboratório exato, que o produziu, o que só é possível porque esses componentes foram construídos, e agora estão instrumentados, de forma consistente o bastante para se compor num único sistema conectado: a prova concreta e prática de que os laboratórios construídos separadamente desta disciplina de fato somam a máquina integrada que `operating-systems-i` descreveu.

## Documentation Links

- [Arpaci-Dusseau: Operating Systems: Three Easy Pieces](https://pages.cs.wisc.edu/~remzi/OSTEP/): a fonte do material de escalonamento, memória virtual e sistemas de arquivos em que os laboratórios construídos separadamente desta disciplina, e o cenário conectado deste projeto final, se apoiam o tempo todo.
- [OSTEP Projects: xv6 Kernel Projects](https://github.com/remzi-arpacidusseau/ostep-projects): o conjunto real e oficial de projetos cujos trabalhos de escalonamento e memória virtual servem de modelo para os Laboratórios 9 e 10 desta disciplina, agora rodados juntos no cenário conectado deste projeto final.
