---
version: 1.0
updatedAt: 2026-09-12
title: "Laboratório: um Simulador de Tabela de Páginas e TLB"
summary: "Este laboratório constrói um simulador em espaço de usuário que implementa o percurso de tabela de páginas multinível de Paginação e Tabelas de Páginas sobre um espaço de endereçamento virtual simulado, acrescenta uma pequena cache TLB de tamanho fixo na frente dele exatamente como O Translation Lookaside Buffer descreve, e mede diretamente, contando acessos reais à memória simulada, a diferença real de taxa de acerto que um TLB faz e o comportamento real de thrashing que Políticas de Substituição de Páginas prevê quando o working set simulado passa a exceder os quadros físicos disponíveis, sob substituição FIFO contra LRU."
---
## Objetivos de Aprendizagem

- Implementar um simulador de tabela de páginas de dois níveis que traduz um endereço virtual simulado num endereço físico, correspondendo ao percurso multinível que a teoria já cobre.
- Implementar uma pequena cache TLB de tamanho fixo na frente do percurso da tabela de páginas, e medir a diferença real de taxa de acerto que ela faz num padrão de acesso real.
- Implementar as políticas de substituição de páginas FIFO e LRU, e medir seu comportamento diferente quando o working set simulado excede os quadros físicos disponíveis.
- Reproduzir, com números medidos de verdade, o comportamento de thrashing que `demand-paging-and-thrashing` descreve na teoria.

## Contexto e Motivação

**Paginação e Tabelas de Páginas**, **O Translation Lookaside Buffer** e **Políticas de Substituição de Páginas** já cobrem, na teoria, como uma tabela de páginas multinível traduz endereços virtuais, por que existe uma cache TLB para evitar percorrer essa tabela a cada acesso à memória, e o que acontece quando a memória física acaba e páginas precisam ser despejadas para abrir espaço para outras. Este laboratório constrói um simulador em espaço de usuário que implementa as três coisas, no espírito do próprio trabalho de memória virtual do xv6 nos OSTEP-projects, e todo o seu valor está em transformar "um TLB deveria reduzir o tempo médio de acesso" e "o thrashing acontece quando o working set excede a memória física" de afirmações em números medidos numa execução simulada real.

## Teoria Central

Nada sobre *por que* uma tabela de páginas multinível troca velocidade de consulta por eficiência de espaço, ou *por que* um TLB explora a localidade temporal em padrões de acesso reais, é rederivado aqui; os dois argumentos já existem em `paging-and-page-tables` e `the-translation-lookaside-buffer`. Este laboratório implementa esses projetos diretamente, sobre um espaço de endereçamento simulado (e não real, em nível de kernel), justamente para que o custo de cada passo de tradução possa ser contado com precisão.

## Exemplos Resolvidos

### Especificação da API

```text
class PageTableSimulator(levels: int, entries_per_level: int, frames: int, policy: str)
    def translate(self, virtual_address: int) -> int
        # devolve o endereço físico; internamente conta se isto foi um acerto
        # no TLB, um acerto na tabela de páginas ou uma falta de página que
        # exigiu despejo segundo a política de substituição configurada
    def stats(self) -> dict  # {"tlb_hits": ..., "page_faults": ..., "evictions": ...}
```

### Passo 1: o percurso da tabela de páginas multinível, contado passo a passo

```python
class PageTableSimulator:
    def __init__(self, levels, entries_per_level, frames, policy):
        self.levels = levels
        self.page_table = {}          # tabela multinível simulada, como dict
        self.physical_frames = {}     # frame_number -> página virtual que está lá
        self.free_frames = list(range(frames))
        self.policy = FIFOPolicy() if policy == "FIFO" else LRUPolicy()
        self.tlb = TLB(size=16)
        self.stats = {"tlb_hits": 0, "page_faults": 0, "evictions": 0}

    def _walk_page_table(self, vpn: int) -> int:
        # Cada nível do percurso é contado como um acesso real à memória,
        # exatamente o que o hardware real faz, e exatamente por que uma falta
        # no TLB é cara em relação a um acerto: uma tabela de N níveis custa N
        # acessos extras ANTES de o acesso real aos dados acontecer.
        for level in range(self.levels):
            self.stats.setdefault("page_table_accesses", 0)
            self.stats["page_table_accesses"] += 1
        if vpn not in self.page_table:
            self._handle_page_fault(vpn)
        return self.page_table[vpn]
```

### Passo 2: o TLB, consultado PRIMEIRO, antes de qualquer percurso da tabela de páginas

```python
class TLB:
    def __init__(self, size: int):
        self.size = size
        self.entries = {}  # vpn -> frame, uma cache pequena e de tamanho fixo

    def lookup(self, vpn: int):
        return self.entries.get(vpn)  # None numa falta no TLB

    def insert(self, vpn: int, frame: int):
        if len(self.entries) >= self.size:
            self.entries.pop(next(iter(self.entries)))  # despeja a mais antiga, de forma simplista
        self.entries[vpn] = frame

def translate(self, virtual_address: int) -> int:
    vpn, offset = split_address(virtual_address)
    frame = self.tlb.lookup(vpn)
    if frame is not None:
        self.stats["tlb_hits"] += 1
        return combine(frame, offset)  # acerto no TLB: pula o percurso INTEIRO
                                          # da tabela de páginas do Passo 1; esse
                                          # é o propósito inteiro de um TLB
    frame = self._walk_page_table(vpn)  # falta no TLB: paga o custo do percurso completo
    self.tlb.insert(vpn, frame)
    return combine(frame, offset)
```

### Passo 3: substituição de páginas FIFO contra LRU, em sequências de acesso reais

```python
class FIFOPolicy:
    def __init__(self):
        self.order = []  # ordem de inserção; despeja a MAIS ANTIGA, sem importar
                            # quão recentemente ela foi de fato acessada
    def choose_victim(self):
        return self.order.pop(0)

class LRUPolicy:
    def __init__(self):
        self.access_order = []  # reordenada a CADA acesso, e não só na inserção
    def record_access(self, vpn):
        if vpn in self.access_order:
            self.access_order.remove(vpn)
        self.access_order.append(vpn)  # a usada mais recentemente vai para o fim
    def choose_victim(self):
        return self.access_order.pop(0)  # despeja a MENOS recentemente usada
```

### Passo 4: reproduzindo o thrashing, com números medidos de verdade

```python
def test_thrashing_when_working_set_exceeds_frames():
    sim = PageTableSimulator(levels=2, entries_per_level=64, frames=4, policy="LRU")
    working_set = list(range(4))     # cabe exatamente em 4 quadros: sem thrashing
    for _ in range(1000):
        for vpn in working_set:
            sim.translate_vpn(vpn)
    fault_rate_fits = sim.stats["page_faults"] / 1000

    sim2 = PageTableSimulator(levels=2, entries_per_level=64, frames=4, policy="LRU")
    working_set2 = list(range(8))    # o DOBRO dos quadros disponíveis
    for _ in range(1000):
        for vpn in working_set2:
            sim2.translate_vpn(vpn)
    fault_rate_thrashing = sim2.stats["page_faults"] / 1000

    assert fault_rate_thrashing > fault_rate_fits * 5, \
        "um working set que excede os quadros físicos deveria mostrar dramaticamente mais faltas"
```

Rodar as duas configurações e comparar diretamente suas taxas de falta medidas é o que transforma a afirmação teórica de `demand-paging-and-thrashing` (de que o thrashing começa quando o working set de um processo não cabe mais na memória física) numa diferença concreta e observada de números, e não num diagrama.

## Equívocos Comuns e Armadilhas

- **"Um acerto e uma falta no TLB custam mais ou menos o mesmo, já que os dois acabam devolvendo um endereço físico."** A contagem de acessos por nível do Passo 1 foi construída especificamente para tornar isso falso na saída medida: uma falta paga o percurso multinível completo antes de sequer tentar o acesso real aos dados, enquanto um acerto pula esse percurso inteiro, e esse é o motivo real e mensurável de os TLBs importarem para o desempenho, e não só uma conveniência teórica.
- **"FIFO e LRU deveriam se sair mais ou menos igual na prática, já que ambas são só políticas de despejo."** As duas políticas do Passo 3 acompanham informações genuinamente diferentes (só a ordem de inserção no FIFO, contra uma ordem de recência atualizada continuamente no LRU), e o tipo de comparação medida do Passo 4, rodada num padrão de acesso real com localidade de verdade, rotineiramente mostra o LRU dando menos faltas justamente porque ele acompanha o que o FIFO ignora de propósito: quais páginas foram usadas mais recentemente, e não só quais chegaram primeiro.
- **"Thrashing é um termo vago e informal, e não algo com uma assinatura precisa e mensurável."** O teste do Passo 4 lhe dá uma assinatura precisa e verificável: a taxa de faltas subindo de forma abrupta e desproporcional quando o working set cruza a fronteira dos quadros disponíveis, exatamente o padrão que `demand-paging-and-thrashing` prevê e que a comparação deste laboratório confirma com números reais.

## Resumo

Este laboratório constrói um simulador em espaço de usuário que implementa o percurso multinível de `paging-and-page-tables`, a camada de cache de `the-translation-lookaside-buffer` consultada antes desse percurso, e as estratégias de despejo FIFO e LRU de `page-replacement-policies`, contando acessos reais à memória simulada em cada passo, em vez de só descrever os mecanismos. Comparar as taxas de falta medidas entre um working set que cabe nos quadros físicos disponíveis e um que não cabe é o que transforma a previsão teórica de `demand-paging-and-thrashing` numa diferença concreta e observada de números, e comparar FIFO com LRU no mesmo padrão de acesso real é o que torna visível, como dado medido e não como suposição, a diferença prática entre "ordem de inserção" e "ordem de recência".

## Documentation Links

- [OSTEP Projects: xv6 Kernel Projects (Virtual Memory)](https://github.com/remzi-arpacidusseau/ostep-projects): os trabalhos reais e oficiais de memória virtual do xv6 nos quais o projeto do simulador deste laboratório se inspira.
- [Arpaci-Dusseau: Operating Systems: Three Easy Pieces, "Paging: Introduction"](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-paging.pdf): a fonte do percurso de tabela de páginas multinível e do projeto de TLB que este laboratório implementa e mede diretamente.
